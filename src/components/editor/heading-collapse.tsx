'use client';

import type { Editor } from '@tiptap/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { isHeadingCollapsed } from './heading-collapse-extension';

type ChevronPos = { top: number; pos: number; level: number; collapsed: boolean };

/**
 * #276 / #117 — heading-collapse hover affordance. A chevron appears in the left
 * gutter when the pointer is over an `h1/h2/h3`; clicking it collapses (visually
 * hides) the top-level blocks between this heading and the next heading of
 * equal-or-higher level. This is a per-VIEWER presentation state — no Yjs write,
 * no schema change — so it stays collab-safe (other editors don't see the
 * collapse).
 *
 * #117 FIX: the collapse state is OWNED BY PROSEMIRROR (see
 * `heading-collapse-extension.ts`). This overlay no longer mutates PM-owned
 * block DOM — instead it reads collapsed state from the plugin and the click
 * dispatches the `toggleHeadingCollapse` command. A plugin `decorations` prop
 * applies the `hidden` + `data-cairn-collapsed` attributes, so a ProseMirror
 * redraw (local re-render or remote Yjs edit) can no longer wipe the collapse.
 */
export function HeadingCollapse({ editor }: { editor: Editor }) {
  const t = useT();
  const [chevron, setChevron] = useState<ChevronPos | null>(null);

  // Track the hovered heading to position the chevron. Reads the live collapsed
  // state from the plugin (never local DOM/ref state).
  useEffect(() => {
    const root = editor.view.dom as HTMLElement;
    function onMove(e: MouseEvent) {
      const node = (e.target as HTMLElement)?.closest('h1, h2, h3');
      if (!node || !root.contains(node)) {
        setChevron(null);
        return;
      }
      const rect = node.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const pos = editor.view.posAtDOM(node, 0);
      const $pos = editor.state.doc.resolve(pos);
      const headingStart = $pos.before(1);
      const level = Number(node.tagName.slice(1));
      setChevron({
        top: rect.top - rootRect.top,
        pos: headingStart,
        level,
        collapsed: isHeadingCollapsed(editor.state, headingStart),
      });
    }
    root.addEventListener('mousemove', onMove);
    return () => root.removeEventListener('mousemove', onMove);
  }, [editor]);

  // Keep the chevron's collapsed/expanded glyph in sync when the plugin state
  // changes (e.g. a toggle, or a remapped position after a concurrent edit).
  useEffect(() => {
    const onTx = () => {
      setChevron((prev) =>
        prev ? { ...prev, collapsed: isHeadingCollapsed(editor.state, prev.pos) } : prev,
      );
    };
    editor.on('transaction', onTx);
    return () => {
      editor.off('transaction', onTx);
    };
  }, [editor]);

  const toggle = useCallback(() => {
    if (!chevron) return;
    // #117 — dispatch the plugin transaction; ProseMirror owns the state and
    // re-derives the `hidden` decorations on the next redraw.
    editor.chain().focus().toggleHeadingCollapse(chevron.pos).run();
    setChevron({ ...chevron, collapsed: isHeadingCollapsed(editor.state, chevron.pos) });
  }, [chevron, editor]);

  if (!chevron) return null;

  const isCollapsed = chevron.collapsed;
  const Icon = isCollapsed ? ChevronRight : ChevronDown;
  const label = isCollapsed ? t('editor.heading.expand') : t('editor.heading.collapse');

  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={!isCollapsed}
      title={label}
      data-heading-collapse-toggle=""
      onClick={toggle}
      style={{ position: 'absolute', top: chevron.top, left: -28 }}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
