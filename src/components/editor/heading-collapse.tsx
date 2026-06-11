'use client';

import type { Editor } from '@tiptap/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { isHeadingCollapsed } from './heading-collapse-extension';

type ChevronEntry = { pos: number; top: number; collapsed: boolean };

/**
 * #276 / #117 — heading-collapse affordance. A chevron sits in the left gutter
 * of every visible `h1/h2/h3`; clicking it collapses (visually hides) the
 * sibling blocks between this heading and the next heading of equal-or-higher
 * level. This is a per-VIEWER presentation state — no Yjs write, no schema
 * change — so it stays collab-safe (other editors don't see the collapse).
 *
 * #117 FIX: the collapse state is OWNED BY PROSEMIRROR (see
 * `heading-collapse-extension.ts`). This overlay never mutates PM-owned block
 * DOM — it reads collapsed state from the plugin and the click dispatches the
 * `toggleHeadingCollapse` command. A plugin `decorations` prop applies the
 * `hidden` + `data-cairn-collapsed` attributes, so a ProseMirror redraw (local
 * re-render or remote Yjs edit) can no longer wipe the collapse.
 *
 * v0.10.0 E3 — discoverability. The old overlay mounted ONE chevron only while
 * the pointer hovered a heading, so the affordance was invisible everywhere
 * else: a collapsed heading showed no chevron once the pointer left, and touch
 * devices (no hover) never saw it at all. Now a button is rendered for EVERY
 * visible collapsible heading and CSS (`.heading-collapse-chevron` in
 * globals.css) drives the reveal:
 *   - hidden at opacity 0 (pointer-events: none) by default — never a layout
 *     shift, the button is always absolutely positioned in the gutter;
 *   - pointer anywhere over the heading row → `data-row-hovered` → opacity .5;
 *   - direct chevron hover / keyboard focus → opacity 1;
 *   - collapsed heading → `data-collapsed` → opacity 1 with NO hover (the
 *     state must stay visible);
 *   - `@media (pointer: coarse)` → always visible (touch has no hover).
 */
export function HeadingCollapse({ editor }: { editor: Editor }) {
  const t = useT();
  const [entries, setEntries] = useState<ChevronEntry[]>([]);
  const [hoveredPos, setHoveredPos] = useState<number | null>(null);
  const entriesRef = useRef<ChevronEntry[]>(entries);
  entriesRef.current = entries;

  // Rebuild the chevron list from the live editor DOM + plugin state. Skips
  // headings that have no visible row to anchor to: blocks hidden by a
  // collapsed ancestor section (`data-cairn-collapsed`), a PM `hidden`
  // decoration, or a closed toggle block (Tailwind `.hidden` wrapper).
  const recompute = useCallback(() => {
    if (editor.isDestroyed) return;
    const root = editor.view.dom as HTMLElement;
    const rootRect = root.getBoundingClientRect();
    const next: ChevronEntry[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3'))) {
      if (el.closest('[data-cairn-collapsed], [hidden], .hidden')) continue;
      // posAtDOM can throw while the view is being rebuilt (e.g. the initial
      // Yjs sync replacing the doc). Skip the heading — the next transaction
      // recomputes.
      try {
        const pos = editor.view.posAtDOM(el, 0);
        const $pos = editor.state.doc.resolve(pos);
        // The heading node's OWN start — `$pos.parent` here is the heading
        // itself, so `before($pos.depth)` is the position directly before it
        // (works for headings nested in columns/toggles/callouts too; see the
        // v0.9.19 A1 note in heading-collapse-extension.ts).
        const headingStart = $pos.before($pos.depth);
        next.push({
          pos: headingStart,
          top: el.getBoundingClientRect().top - rootRect.top,
          collapsed: isHeadingCollapsed(editor.state, headingStart),
        });
      } catch {
        // View mid-rebuild — skip.
      }
    }
    setEntries(next);
  }, [editor]);

  // Recompute on every editor transaction (doc edits, collapse toggles, remote
  // Yjs updates — TipTap emits after the DOM is updated) and on layout changes
  // that move headings WITHOUT a transaction (images loading, container
  // resize). ResizeObserver is guarded for jsdom.
  useEffect(() => {
    recompute();
    const onTx = () => recompute();
    editor.on('transaction', onTx);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => recompute());
      ro.observe(editor.view.dom);
    }
    return () => {
      editor.off('transaction', onTx);
      ro?.disconnect();
    };
  }, [editor, recompute]);

  // Track which heading row the pointer is over. The chevron of the hovered
  // row gets `data-row-hovered` (CSS reveals it at half opacity).
  useEffect(() => {
    const root = editor.view.dom as HTMLElement;
    function onMove(e: MouseEvent) {
      const node = (e.target as HTMLElement)?.closest('h1, h2, h3');
      if (node && root.contains(node)) {
        try {
          const pos = editor.view.posAtDOM(node, 0);
          const $pos = editor.state.doc.resolve(pos);
          setHoveredPos($pos.before($pos.depth));
        } catch {
          // View mid-rebuild — keep the current hover as-is.
        }
        return;
      }
      // Don't clear while the pointer travels from the heading text to the
      // gutter chevron: intermediate mousemove targets (the editor root, a
      // margin) used to drop the hover before the button could be reached.
      // Keep it while the pointer stays in the gutter band next to the
      // chevron; clear everywhere else.
      setHoveredPos((prev) => {
        if (prev == null) return null;
        const entry = entriesRef.current.find((en) => en.pos === prev);
        if (!entry) return null;
        const rootRect = root.getBoundingClientRect();
        const inGutter = e.clientX <= rootRect.left + 8 && e.clientX >= rootRect.left - 44;
        const inBand = Math.abs(e.clientY - (rootRect.top + entry.top + 12)) <= 28;
        return inGutter && inBand ? prev : null;
      });
    }
    root.addEventListener('mousemove', onMove);
    return () => root.removeEventListener('mousemove', onMove);
  }, [editor]);

  const toggle = useCallback(
    (pos: number) => {
      // #117 — dispatch the plugin transaction; ProseMirror owns the state and
      // re-derives the `hidden` decorations on the next redraw (the
      // 'transaction' listener above recomputes the chevron list).
      editor.chain().focus().toggleHeadingCollapse(pos).run();
    },
    [editor],
  );

  return (
    <>
      {entries.map((entry) => {
        const Icon = entry.collapsed ? ChevronRight : ChevronDown;
        const label = entry.collapsed ? t('editor.heading.expand') : t('editor.heading.collapse');
        return (
          <button
            key={entry.pos}
            type="button"
            aria-label={label}
            aria-expanded={!entry.collapsed}
            title={label}
            data-heading-collapse-toggle=""
            data-collapsed={entry.collapsed ? '' : undefined}
            data-row-hovered={hoveredPos === entry.pos ? '' : undefined}
            onClick={() => toggle(entry.pos)}
            style={{ position: 'absolute', top: entry.top, left: -28 }}
            className="heading-collapse-chevron flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
          </button>
        );
      })}
    </>
  );
}
