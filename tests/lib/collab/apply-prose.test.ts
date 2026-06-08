import { describe, expect, it } from 'vitest';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { applyProseJsonToFragment } from '@/lib/collab/apply-prose';

/**
 * The schema-free PM-JSON → Yjs-XML writer must be the exact inverse of
 * yjsStateToProseDoc()'s reader (y-prosemirror's yDocToProsemirrorJSON), and it
 * must NOT require a ProseMirror schema — that's the whole point (the collab
 * process has no TipTap schema). These tests prove faithful round-tripping
 * INCLUDING a custom node (callout) that no basic schema would accept.
 */
describe('applyProseJsonToFragment', () => {
  function roundtrip(doc: unknown): unknown {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('default');
    ydoc.transact(() => applyProseJsonToFragment(frag, doc));
    return yDocToProsemirrorJSON(ydoc, 'default');
  }

  it('round-trips paragraphs, headings, attrs and marks', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'API-written' },
            { type: 'text', text: ' content' },
          ],
        },
      ],
    };
    const back = roundtrip(doc) as { content: unknown[] };
    const str = JSON.stringify(back);
    expect(str).toContain('API-written');
    expect(str).toContain('"level":2');
    expect(str).toContain('bold');
  });

  it('round-trips a CUSTOM node (callout) with no schema — the key collab-process case', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { color: 'blue' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'custom body' }] }],
        },
      ],
    };
    const back = roundtrip(doc);
    const str = JSON.stringify(back);
    expect(str).toContain('callout');
    expect(str).toContain('"color":"blue"');
    expect(str).toContain('custom body');
  });

  it('replaces existing fragment content (delete-then-insert is idempotent)', () => {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('default');
    ydoc.transact(() =>
      applyProseJsonToFragment(frag, {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
      }),
    );
    ydoc.transact(() =>
      applyProseJsonToFragment(frag, {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
      }),
    );
    const str = JSON.stringify(yDocToProsemirrorJSON(ydoc, 'default'));
    expect(str).toContain('second');
    expect(str).not.toContain('first');
  });

  it('handles an empty doc (clears the fragment)', () => {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('default');
    ydoc.transact(() => applyProseJsonToFragment(frag, { type: 'doc', content: [] }));
    expect(frag.length).toBe(0);
  });
});
