'use client';

import { useEffect, useState } from 'react';
import { collectHeadings, type HeadingEntry } from '@/lib/editor/headings';

export type TocSidebarProps = {
  /** Initial document JSON used to populate the outline before any edits. */
  initialDoc: unknown;
};

/**
 * Sticky right-rail Table of Contents. Auto-built from the page's headings
 * (h1-h4). Active heading tracked via IntersectionObserver — updates
 * aria-current="location" on the link whose target is the most-recently-
 * intersecting heading.
 *
 * Listens for `cairn:editor:doc-changed` CustomEvents on `window` to refresh
 * the outline as the user edits. The editor (Yjs/TipTap consumer) emits this
 * event with `detail.doc = editor.getJSON()` whenever the doc is mutated.
 * No event = static initial-doc-only outline, which is the right behaviour
 * for the public reader path.
 *
 * Coexists with the v0.6 P6 inline TOC node (`toc-node-view.tsx`). The two
 * surfaces render the same heading list but live in distinct DOM trees and
 * don't share state.
 */
export function TocSidebar({ initialDoc }: TocSidebarProps) {
  const [headings, setHeadings] = useState<HeadingEntry[]>(() => collectHeadings(initialDoc));
  const [activeId, setActiveId] = useState<string | null>(null);

  // Refresh on editor-doc-changed events. Effect re-attaches on each render
  // but listener identity is stable across renders (useCallback would also
  // work — useEffect with [] also works since we read state setters only).
  useEffect(() => {
    const onChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<{ doc?: unknown }>).detail;
      if (!detail?.doc) return;
      setHeadings(collectHeadings(detail.doc));
    };
    window.addEventListener('cairn:editor:doc-changed', onChanged);
    return () => window.removeEventListener('cairn:editor:doc-changed', onChanged);
  }, []);

  // IntersectionObserver — watches all heading targets in the editor surface.
  // Re-binds whenever the heading list changes (new ids appear / disappear).
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const ids = headings.map((h) => h.id);
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the most-recent intersecting entry. If multiple are intersecting
        // at once (the reader is partway through), take the first one in
        // document order.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => ids.indexOf(a.target.id) - ids.indexOf(b.target.id));
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0.1 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) {
    return (
      <aside className="text-sm text-muted-foreground" aria-label="Table of contents">
        No headings yet.
      </aside>
    );
  }

  return (
    <aside className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        On this page
      </h2>
      <nav aria-label="Table of contents">
        <ol className="space-y-0.5">
          {headings.map((h) => {
            const isActive = activeId === h.id;
            return (
              <li key={h.id} style={{ paddingInlineStart: `${(h.level - 1) * 12}px` }}>
                <a
                  href={`#${h.id}`}
                  className={
                    isActive
                      ? 'block rounded px-1 py-0.5 text-foreground font-medium underline-offset-2'
                      : 'block rounded px-1 py-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/40'
                  }
                  aria-current={isActive ? 'location' : undefined}
                >
                  {h.text || 'Untitled'}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}
