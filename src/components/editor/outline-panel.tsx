'use client';

import type { Editor } from '@tiptap/react';
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

  return (
    <aside
      aria-label={t('outline.title')}
      className="absolute end-0 top-0 z-20 max-h-screen w-56 overflow-y-auto rounded-md border bg-popover p-3 text-sm shadow-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('outline.title')}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded text-xs text-muted-foreground hover:bg-accent"
            aria-label={t('outline.hide')}
          >
            ✕
          </button>
        )}
      </div>
      {headings.length === 0 ? (
        <p className="text-muted-foreground">{t('outline.empty')}</p>
      ) : (
        <ul className="space-y-0.5">
          {headings.map((h, i) => (
            <li key={h.id} style={{ paddingInlineStart: `${(h.level - 1) * 10}px` }}>
              <button
                type="button"
                onClick={() => scrollToHeading(i)}
                className="block w-full truncate text-start text-muted-foreground hover:text-foreground"
                title={h.text}
              >
                {h.text || 'Untitled'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
