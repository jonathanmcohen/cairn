import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { baseExtensions } from '@/components/editor/extensions';

/**
 * v0.8.0 P24 video audit: the new `video` node — an atomic block with attrs
 * `{fileId, mimeType}` rendered as `<video controls>` whose `<source src>`
 * points at `/api/files/<id>` — must survive a ProseMirror schema parse/
 * serialize round-trip AND a Yjs encode/decode with attrs intact.
 */
const schema = getSchema(baseExtensions());
const FIELD = 'default';

describe('v0.8.0 P24 video block — schema + Yjs round-trip', () => {
  it('parses through the real schema and back, preserving every attr', () => {
    const DOC = {
      type: 'doc',
      content: [
        {
          type: 'video',
          attrs: {
            fileId: '11111111-1111-1111-1111-111111111111',
            mimeType: 'video/mp4',
            // `src` is the transient public-render override; null in storage.
            src: null,
          },
        },
      ],
    };
    const node = PMNode.fromJSON(schema, DOC);
    const json = node.toJSON();
    expect(json).toEqual(DOC);
  });

  it('round-trips a webm video through Yjs encode/decode unchanged', () => {
    // y-prosemirror omits attrs whose value equals the schema default; the
    // `src` override defaults to null, so it is dropped from the decoded
    // output (renderer reads it back as null). Every non-default attr
    // (fileId, mimeType) survives byte-for-byte.
    const DOC = {
      type: 'doc',
      content: [
        {
          type: 'video',
          attrs: {
            fileId: '22222222-2222-2222-2222-222222222222',
            mimeType: 'video/webm',
            src: null,
          },
        },
      ],
    };
    PMNode.fromJSON(schema, DOC);
    const ydoc = prosemirrorJSONToYDoc(schema, DOC, FIELD);
    const update = Y.encodeStateAsUpdate(ydoc);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, update);
    const out = yDocToProsemirrorJSON(fresh, FIELD) as Record<string, unknown>;
    const node = (out.content as Array<Record<string, unknown>>)[0];
    expect(node?.type).toBe('video');
    const attrs = node?.attrs as Record<string, unknown>;
    expect(attrs.fileId).toBe('22222222-2222-2222-2222-222222222222');
    expect(attrs.mimeType).toBe('video/webm');
    expect(attrs.src ?? null).toBeNull();
  });

  it('round-trips an empty video (no fileId yet) — placeholder state', () => {
    // y-prosemirror omits attrs whose value equals the schema default; both
    // `fileId` and `mimeType` default to null, so the EXPECTED post-decode
    // doc has those attrs stripped (still resolves to null at read time).
    const DOC = {
      type: 'doc',
      content: [{ type: 'video', attrs: { fileId: null, mimeType: null } }],
    };
    PMNode.fromJSON(schema, DOC);
    const ydoc = prosemirrorJSONToYDoc(schema, DOC, FIELD);
    const update = Y.encodeStateAsUpdate(ydoc);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, update);
    const out = yDocToProsemirrorJSON(fresh, FIELD) as Record<string, unknown>;
    const node = (out.content as Array<Record<string, unknown>>)[0];
    expect(node?.type).toBe('video');
    const attrs = (node?.attrs as Record<string, unknown> | undefined) ?? {};
    // Either attrs are absent (matched-default) or explicitly null. Both are
    // observationally equivalent for the renderer.
    expect(attrs.fileId ?? null).toBeNull();
    expect(attrs.mimeType ?? null).toBeNull();
  });

  it('exposes a video node spec marked atom + block', () => {
    const videoSpec = schema.nodes.video;
    expect(videoSpec).toBeDefined();
    expect(videoSpec?.isAtom).toBe(true);
    expect(videoSpec?.isBlock).toBe(true);
  });
});
