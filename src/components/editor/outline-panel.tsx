'use client';

import type { Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { collectHeadings, type HeadingEntry } from '@/lib/editor/headings';

export function OutlinePanel({ editor, onClose }: { editor: Editor; onClose?: () => void }) {
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
      aria-label="Outline"
      className="sticky top-0 max-h-screen w-56 shrink-0 overflow-y-auto border-s p-3 text-sm"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Outline</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1 text-xs text-muted-foreground hover:bg-accent"
            aria-label="Hide outline"
          >
            ✕
          </button>
        )}
      </div>
      {headings.length === 0 ? (
        <p className="text-muted-foreground">No headings.</p>
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
