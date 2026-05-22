'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { collectHeadings, type HeadingEntry } from '@/lib/editor/headings';

/**
 * Read-only list of the document's headings, derived live from the editor doc.
 * Holds NO node attrs and NO persisted state — everything is recomputed from the
 * shared doc, so the node round-trips through Yjs trivially.
 */
export function TableOfContentsNodeView({ editor }: NodeViewProps) {
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
    // Match by document order: the Nth heading element in the rendered surface.
    const dom = editor.view.dom as HTMLElement;
    const els = dom.querySelectorAll('h1, h2, h3');
    els.item(index)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <NodeViewWrapper
      className="my-4 rounded-md border bg-muted/20 px-3 py-2"
      contentEditable={false}
    >
      <div className="mb-1 text-xs font-medium text-muted-foreground">Table of contents</div>
      {headings.length === 0 ? (
        <div className="text-sm text-muted-foreground">No headings yet.</div>
      ) : (
        <ul className="space-y-0.5">
          {headings.map((h, i) => (
            <li key={h.id} style={{ paddingInlineStart: `${(h.level - 1) * 12}px` }}>
              <button
                type="button"
                onClick={() => scrollToHeading(i)}
                className="text-left text-sm text-foreground hover:underline"
              >
                {h.text || 'Untitled'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}
