import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * #117 — heading-collapse state OWNED BY PROSEMIRROR.
 *
 * The original implementation (heading-collapse.tsx) set `hidden` +
 * `data-cairn-collapsed` directly on ProseMirror-owned block DOM via
 * `editor.view.nodeDOM(...)`. ProseMirror's DOMObserver saw the raw attribute
 * mutation, treated it as foreign, and redrew the block (childList add/remove) —
 * recreating the element WITHOUT the attributes, so the collapse never stuck.
 *
 * Fix: model the collapse as editor state, not DOM. A plugin tracks the set of
 * collapsed heading positions (the doc-position of each collapsed heading's
 * start). A `decorations` prop derives node decorations that add `hidden` +
 * `data-cairn-collapsed` to every top-level block between a collapsed heading
 * and the next heading of equal-or-higher level. Because decorations are
 * re-applied by ProseMirror itself on every redraw, a remote Yjs edit or a
 * local re-render can no longer wipe the collapse.
 *
 * Toggling dispatches a transaction carrying `HEADING_COLLAPSE_META`; the set is
 * remapped through every transaction's mapping so positions survive concurrent
 * edits.
 *
 * This is per-VIEWER presentation state — the plugin state is local, never
 * written to the Yjs doc — so it stays collab-safe (other editors don't see the
 * collapse), exactly as the prior overlay was.
 */

export const headingCollapsePluginKey = new PluginKey<HeadingCollapseState>('headingCollapse');

/** Toggle a single heading position. Carried as transaction metadata. */
export type HeadingCollapseMeta = { type: 'toggle'; pos: number };

const HEADING_COLLAPSE_META = 'headingCollapse$';

type HeadingCollapseState = {
  /** Doc-positions of collapsed heading node starts. */
  collapsed: Set<number>;
};

/** The heading levels that get a collapse affordance (h1/h2/h3). */
const COLLAPSIBLE_LEVELS = new Set([1, 2, 3]);

function isCollapsibleHeading(node: PMNode): boolean {
  return node.type.name === 'heading' && COLLAPSIBLE_LEVELS.has(node.attrs.level as number);
}

/**
 * Build the decoration set for the current doc + collapsed positions. For each
 * collapsed heading, hide every following TOP-LEVEL block until the next heading
 * whose level <= the collapsed heading's level (a same-or-higher heading ends
 * the section; deeper headings are part of it and stay hidden).
 */
function buildDecorations(doc: PMNode, collapsed: Set<number>): DecorationSet {
  if (collapsed.size === 0) return DecorationSet.empty;

  // Flat list of top-level children with their start offsets + heading levels.
  const tops: { pos: number; node: PMNode; isHeading: boolean; level: number }[] = [];
  doc.forEach((node, offset) => {
    const heading = isCollapsibleHeading(node);
    tops.push({
      pos: offset,
      node,
      isHeading: heading,
      level: heading ? (node.attrs.level as number) : 0,
    });
  });

  const decorations: Decoration[] = [];
  for (let i = 0; i < tops.length; i++) {
    const entry = tops[i];
    if (!entry?.isHeading || !collapsed.has(entry.pos)) continue;
    for (let j = i + 1; j < tops.length; j++) {
      const sib = tops[j];
      if (!sib) break;
      // Stop at the next heading of equal-or-higher level.
      if (sib.isHeading && sib.level <= entry.level) break;
      decorations.push(
        Decoration.node(sib.pos, sib.pos + sib.node.nodeSize, {
          hidden: '',
          'data-cairn-collapsed': '',
        }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

/** Read the set of collapsed heading positions from the live editor state. */
export function getCollapsedHeadings(state: {
  // biome-ignore lint/suspicious/noExplicitAny: EditorState is structurally compatible; avoid a hard pm dep in callers.
  plugins?: any;
}): Set<number> {
  const pluginState = headingCollapsePluginKey.getState(state as never);
  return pluginState?.collapsed ?? new Set<number>();
}

/** Is the heading at `pos` currently collapsed? */
export function isHeadingCollapsed(
  // biome-ignore lint/suspicious/noExplicitAny: see getCollapsedHeadings.
  state: any,
  pos: number,
): boolean {
  return getCollapsedHeadings(state).has(pos);
}

/**
 * Stamp a toggle onto a transaction (so callers can `editor.view.dispatch` it).
 * Exposed for the React overlay; the extension also registers a chainable
 * `toggleHeadingCollapse` command.
 */
export function setHeadingCollapseToggle(tr: Transaction, pos: number): Transaction {
  return tr.setMeta(HEADING_COLLAPSE_META, { type: 'toggle', pos } satisfies HeadingCollapseMeta);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingCollapse: {
      /** Toggle the collapsed state of the heading whose node starts at `pos`. */
      toggleHeadingCollapse: (pos: number) => ReturnType;
    };
  }
}

export const HeadingCollapseExtension = Extension.create({
  name: 'headingCollapse',

  addCommands() {
    return {
      toggleHeadingCollapse:
        (pos: number) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(setHeadingCollapseToggle(state.tr, pos));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<HeadingCollapseState>({
        key: headingCollapsePluginKey,
        state: {
          init: () => ({ collapsed: new Set<number>() }),
          apply: (tr, value) => {
            let collapsed = value.collapsed;

            // Remap existing positions through the transaction so a collapse
            // survives concurrent edits (local typing AND remote Yjs updates).
            if (tr.docChanged && collapsed.size > 0) {
              const remapped = new Set<number>();
              for (const pos of collapsed) {
                const mapped = tr.mapping.mapResult(pos);
                // Drop the entry if the heading position was deleted.
                if (!mapped.deleted) remapped.add(mapped.pos);
              }
              collapsed = remapped;
            }

            const meta = tr.getMeta(HEADING_COLLAPSE_META) as HeadingCollapseMeta | undefined;
            if (meta?.type === 'toggle') {
              const next = new Set(collapsed);
              if (next.has(meta.pos)) next.delete(meta.pos);
              else next.add(meta.pos);
              collapsed = next;
            }

            return collapsed === value.collapsed ? value : { collapsed };
          },
        },
        props: {
          decorations(state) {
            const pluginState = headingCollapsePluginKey.getState(state);
            if (!pluginState) return DecorationSet.empty;
            return buildDecorations(state.doc, pluginState.collapsed);
          },
        },
      }),
    ];
  },
});
