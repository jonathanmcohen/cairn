import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { baseExtensions } from '@/components/editor/extensions';

describe('Yjs round-trip — suggestion marks/node', () => {
  it('preserves suggestionInsert / suggestionDelete / suggestionBlock attrs', () => {
    const schema = getSchema(baseExtensions());
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'kept ' },
            {
              type: 'text',
              text: 'added',
              marks: [
                {
                  type: 'suggestionInsert',
                  attrs: { suggestionId: 's1', authorId: 'u1', createdAt: '2026-05-22T00:00:00Z' },
                },
              ],
            },
            {
              type: 'text',
              text: ' gone',
              marks: [
                {
                  type: 'suggestionDelete',
                  attrs: { suggestionId: 's2', authorId: 'u1', createdAt: '2026-05-22T00:00:00Z' },
                },
              ],
            },
          ],
        },
        {
          type: 'suggestionBlock',
          attrs: {
            suggestionId: 's3',
            authorId: 'u2',
            createdAt: '2026-05-22T00:00:00Z',
            kind: 'insert',
          },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new block' }] }],
        },
      ],
    };
    const ydoc = prosemirrorJSONToYDoc(schema, doc, 'default');
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(ydoc));
    const out = yDocToProsemirrorJSON(fresh, 'default');
    expect(JSON.stringify(out)).toContain('"suggestionId":"s1"');
    expect(JSON.stringify(out)).toContain('"suggestionDelete"');
    expect(JSON.stringify(out)).toContain('"suggestionBlock"');
    expect(out).toEqual(doc);
  });
});
