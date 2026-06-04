'use client';

import type { Editor } from '@tiptap/react';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { collectHeadings, type HeadingEntry } from '@/lib/editor/headings';
import { useT } from '@/lib/i18n/provider';

export function OutlinePanel({ editor, onClose }: { editor: Editor; onClose?: () => void }) {
  const t = useT();
  const [headings, setHeadings] = useState<HeadingEntry[]>(() =>
    collectHeadings(editor.state.doc.toJSON()),
  );

  useEffect(() => {
    const update = () => setHeadings(collectHeadings(editor.state.doc.toJSON()));
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor]);

  function scrollToHeading(index: number) {
    const dom = editor.view.dom as HTMLElement;
    dom.querySelectorAll('h1, h2, h3').item(index)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  // #234 — full right-side drawer (matching version-history.tsx) instead of the
  // tiny w-56 popover. Nested H1/H2/H3 indentation + click-to-scroll.
  return (
    <div className="fixed inset-y-0 end-0 z-30 shadow-lg">
      <aside
        aria-label={t('outline.title')}
        className="bg-background flex h-full w-80 flex-col border-s"
      >
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="text-sm font-medium">{t('outline.title')}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('outline.hide')}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 text-sm">
          {headings.length === 0 ? (
            <p className="text-muted-foreground">{t('outline.empty')}</p>
          ) : (
            <ul className="space-y-0.5">
              {headings.map((h, i) => (
                <li key={h.id} style={{ paddingInlineStart: `${(h.level - 1) * 14}px` }}>
                  <button
                    type="button"
                    onClick={() => scrollToHeading(i)}
                    title={h.text}
                    className="block w-full truncate text-start text-muted-foreground hover:text-foreground"
                  >
                    {h.text || t('outline.untitled')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
