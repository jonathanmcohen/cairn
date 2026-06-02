'use client';

import type { Editor } from '@tiptap/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';

type ChevronPos = { top: number; pos: number; level: number; collapsed: boolean };

/**
 * #276 — heading-collapse hover affordance. A chevron appears in the left gutter
 * when the pointer is over an `h1/h2/h3`; clicking it collapses (visually hides)
 * the top-level blocks between this heading and the next heading of equal-or-
 * higher level. This is a per-VIEWER presentation state — no Yjs write, no schema
 * change — so it stays collab-safe (other editors don't see the collapse).
 *
 * Reuses the `DragHandle` mousemove-over-heading detection to position the
 * chevron, and re-applies the hidden state on every `editor` update so edits
 * don't desync the overlay.
 */
export function HeadingCollapse({ editor }: { editor: Editor }) {
  const t = useT();
  const [chevron, setChevron] = useState<ChevronPos | null>(null);
  // Set of collapsed heading doc-positions (the position of the heading node's
  // start). Per-viewer in-memory state.
  const collapsedRef = useRef<Set<number>>(new Set());

  /**
   * Walk the top-level children after the heading at `headingPos` and toggle a
   * `data-cairn-collapsed` attribute + `hidden` on each block's DOM until the
   * next heading whose level <= the collapsed heading's level.
   */
  const applyCollapse = useCallback(() => {
    const { doc } = editor.state;
    const collapsed = collapsedRef.current;
    // First clear any stale hidden state, then re-hide for active collapses.
    doc.forEach((_node, offset) => {
      const dom = editor.view.nodeDOM(offset) as HTMLElement | null;
      if (dom?.removeAttribute) {
        dom.removeAttribute('hidden');
        dom.removeAttribute('data-cairn-collapsed');
      }
    });
    if (collapsed.size === 0) return;
    // Build a flat list of top-level (heading|other) entries with their offsets.
    const tops: { offset: number; isHeading: boolean; level: number }[] = [];
    doc.forEach((node, offset) => {
      const isHeading = node.type.name === 'heading';
      tops.push({ offset, isHeading, level: isHeading ? (node.attrs.level as number) : 0 });
    });
    for (let i = 0; i < tops.length; i++) {
      const entry = tops[i];
      if (!entry?.isHeading || !collapsed.has(entry.offset)) continue;
      for (let j = i + 1; j < tops.length; j++) {
        const sib = tops[j];
        if (!sib) break;
        // Stop at the next heading of equal-or-higher level.
        if (sib.isHeading && sib.level <= entry.level) break;
        const dom = editor.view.nodeDOM(sib.offset) as HTMLElement | null;
        if (dom?.setAttribute) {
          dom.setAttribute('hidden', '');
          dom.setAttribute('data-cairn-collapsed', '');
        }
      }
    }
  }, [editor]);

  // Re-apply on every doc update so edits don't desync the hidden overlay.
  useEffect(() => {
    const onUpdate = () => applyCollapse();
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
    };
  }, [editor, applyCollapse]);

  // Track the hovered heading to position the chevron.
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
        collapsed: collapsedRef.current.has(headingStart),
      });
    }
    root.addEventListener('mousemove', onMove);
    return () => root.removeEventListener('mousemove', onMove);
  }, [editor]);

  const toggle = useCallback(() => {
    if (!chevron) return;
    const collapsed = collapsedRef.current;
    if (collapsed.has(chevron.pos)) collapsed.delete(chevron.pos);
    else collapsed.add(chevron.pos);
    applyCollapse();
    setChevron({ ...chevron, collapsed: collapsed.has(chevron.pos) });
  }, [chevron, applyCollapse]);

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
      onClick={toggle}
      style={{ position: 'absolute', top: chevron.top, left: -28 }}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
