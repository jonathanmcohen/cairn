import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { baseExtensions } from '@/components/editor/extensions';

/**
 * v0.6.0 P10 Yjs round-trip audit (mirrors the P5 audit in
 * tests/lib/editor/blocks-yjs-roundtrip.test.ts): a doc containing all three new
 * page-link nodes — an inline `pageLink` and `pageMention` inside a paragraph,
 * plus a block `pageEmbed` — must survive a Yjs encode/decode with their
 * `{ targetPageId, label }` attrs intact. All three are atoms with explicit
 * `addAttributes`, so they should round-trip cleanly; this proves the v0.3.0
 * custom-node collab constraint (y-prosemirror only syncs ProseMirror attr/content
 * state) holds for them.
 */
const schema = getSchema(baseExtensions());
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const docJSON = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ' },
        { type: 'pageLink', attrs: { targetPageId: A, label: 'Roadmap' } },
        { type: 'text', text: ' and ' },
        { type: 'pageMention', attrs: { targetPageId: B, label: 'Specs' } },
      ],
    },
    { type: 'pageEmbed', attrs: { targetPageId: C, label: 'Design' } },
  ],
};

describe('page-link nodes Yjs round-trip', () => {
  it('survives encode→decode unchanged (attrs preserved)', () => {
    const ydoc = prosemirrorJSONToYDoc(schema, docJSON, 'default');
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(ydoc));
    const back = yDocToProsemirrorJSON(fresh, 'default');
    const s = JSON.stringify(back);
    expect(s).toContain('pageLink');
    expect(s).toContain('pageMention');
    expect(s).toContain('pageEmbed');
    expect(s).toContain(A);
    expect(s).toContain(B);
    expect(s).toContain(C);
  });
});
