import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { DateTimeNode } from '@/components/editor/blocks/datetime-node';

/**
 * Yjs custom-node audit (v0.9.0 G3 P20): a doc carrying a `datetime` inline
 * atom with all three attrs must survive `encodeStateAsUpdate` →
 * `applyUpdate` unchanged. y-prosemirror only syncs ProseMirror attrs/content,
 * so any node holding non-attr state would desync here.
 */
const schema = getSchema([StarterKit, DateTimeNode]);
const FIELD = 'default';

function roundTrip(docJSON: Record<string, unknown>): Record<string, unknown> {
  PMNode.fromJSON(schema, docJSON);
  const ydoc = prosemirrorJSONToYDoc(schema, docJSON, FIELD);
  const update = Y.encodeStateAsUpdate(ydoc);
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, update);
  return yDocToProsemirrorJSON(fresh, FIELD) as Record<string, unknown>;
}

describe('DateTimeNode Yjs roundtrip', () => {
  it('survives encode → decode with all three attrs intact', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'datetime',
              attrs: {
                iso: '2026-05-26T15:00:00.000Z',
                tz: 'America/New_York',
                display_format: 'yyyy-LL-dd HH:mm',
              },
            },
          ],
        },
      ],
    };
    const out = roundTrip(doc);
    expect(out).toEqual(doc);
  });

  it('preserves multiple datetime nodes in a single paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'datetime',
              attrs: {
                iso: '2026-12-25T00:00:00.000Z',
                tz: 'Pacific/Auckland',
                display_format: 'yyyy-LL-dd HH:mm',
              },
            },
            { type: 'text', text: ' to ' },
            {
              type: 'datetime',
              attrs: {
                iso: '2026-12-26T00:00:00.000Z',
                tz: 'Pacific/Auckland',
                display_format: 'yyyy-LL-dd HH:mm',
              },
            },
          ],
        },
      ],
    };
    const out = roundTrip(doc);
    expect(out).toEqual(doc);
  });
});
