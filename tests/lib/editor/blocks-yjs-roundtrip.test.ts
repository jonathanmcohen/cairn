import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { baseExtensions } from '@/components/editor/extensions';

/**
 * v0.6.0 P5 Yjs round-trip audit (mirrors the v0.3.0 custom-node audit in
 * tests/components/editor/blocks-yjs-roundtrip.test.ts): a doc containing every
 * new P5 node — embed, bookmark, an inline math, a display math, and a
 * source+mirror syncedBlock pair sharing one syncedBlockId — must survive both a
 * ProseMirror schema serialize/parse round-trip AND a Yjs encode/decode with all
 * attrs intact. y-prosemirror only syncs state derived from ProseMirror
 * attrs/content; a node holding non-attr state would drop or desync here.
 *
 * NOTE 1: the math node is `inline`/`group: 'inline'` (atom). Its node `name` is
 * 'math' even though it is exported as `MathBlock` (Biome forbids shadowing the
 * `Math` global). A "display" math is still an inline node, so it must sit inside
 * a block (a paragraph) — it cannot be a direct child of `doc` (which is
 * `block+`). The fixture wraps the display math in its own paragraph.
 *
 * NOTE 2: this suite runs in the `node` test environment (no DOM), so it uses the
 * pure ProseMirror schema (PMNode.fromJSON/.toJSON) and y-prosemirror — never
 * generateHTML/DOMSerializer, which need `window`. That is exactly the path the
 * collaborative editor's Yjs sync uses, so it is the meaningful contract.
 */
const DOC = {
  type: 'doc',
  content: [
    // P6: the tableOfContents node is a block atom with NO attrs + NO node-local
    // state — it is Yjs-safe by construction and must survive the round-trip as-is.
    { type: 'tableOfContents' },
    {
      type: 'embed',
      attrs: { provider: 'youtube', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
    },
    {
      type: 'bookmark',
      attrs: {
        url: 'https://example.com',
        title: 'Example',
        description: 'Desc',
        image: null,
        favicon: 'https://example.com/favicon.ico',
      },
    },
    {
      type: 'paragraph',
      content: [{ type: 'math', attrs: { latex: 'a^2+b^2=c^2', display: false } }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'math', attrs: { latex: '\\int_0^1 x\\,dx', display: true } }],
    },
    {
      type: 'syncedBlock',
      attrs: { syncedBlockId: 'sb-1' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'source' }] }],
    },
    {
      type: 'syncedBlock',
      attrs: { syncedBlockId: 'sb-1' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'mirror-placeholder' }] }],
    },
  ],
};

// The same extension set the collaborative editor uses, so the schema under test
// is the real one (embed/bookmark/math/syncedBlock all registered).
const schema = getSchema(baseExtensions());
const FIELD = 'default';

/** Pull the math node's attrs out of a doc's Nth top-level child (a paragraph). */
function mathNodeAt(
  doc: Record<string, unknown>,
  index: number,
): { latex?: string; display?: boolean } | undefined {
  const content = (doc.content as Array<Record<string, unknown>> | undefined) ?? [];
  const para = content[index];
  const inner = (para?.content as Array<Record<string, unknown>> | undefined) ?? [];
  const math = inner[0];
  return math?.attrs as { latex?: string; display?: boolean } | undefined;
}

describe('v0.6.0 P5 blocks survive a schema + Yjs round-trip', () => {
  it('parses through the real schema and back, preserving node types and attrs', () => {
    // PMNode.fromJSON validates the doc against the actual editor schema; if any
    // node/attr were unknown it would throw. .toJSON() then re-serializes it.
    const node = PMNode.fromJSON(schema, DOC);
    const json = node.toJSON();
    const str = JSON.stringify(json);

    // every new node type is present after the schema round-trip
    expect(str).toContain('"embed"');
    expect(str).toContain('"bookmark"');
    expect(str).toContain('"syncedBlock"');
    expect(str).toContain('"math"');

    // and the load-bearing attr values survive
    expect(str).toContain('dQw4w9WgXcQ'); // embed src id
    expect(str).toContain('a^2+b^2=c^2'); // inline math latex
    expect(str).toContain('sb-1'); // shared syncedBlockId
    // the display-math latex contains backslashes; assert on the parsed value
    // rather than the JSON-escaped string to avoid double-escaping confusion.
    expect(str).toContain('"tableOfContents"');
    const displayMath = mathNodeAt(json, 4);
    expect(displayMath?.latex).toBe('\\int_0^1 x\\,dx');
    expect(displayMath?.display).toBe(true);
  });

  it('encodes to a Y.Doc, applies an update, and decodes with attrs intact', () => {
    // The fixture must be a legal doc for the real schema before encoding.
    PMNode.fromJSON(schema, DOC);

    const ydoc = prosemirrorJSONToYDoc(schema, DOC, FIELD);
    const update = Y.encodeStateAsUpdate(ydoc);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, update);
    const out = yDocToProsemirrorJSON(fresh, FIELD) as Record<string, unknown>;

    expect(out).toBeTruthy();

    // Structural identity against the EXPECTED post-round-trip doc. The ONLY
    // difference from DOC is the bookmark's `image: null`: y-prosemirror omits
    // attrs whose value equals the node's schema default (bookmark.image
    // defaults to null), so a null image is not re-emitted. That is lossless —
    // the decoded node still resolves `image` to null — not a desync. Every
    // non-default attr survives byte-for-byte.
    const EXPECTED = structuredClone(DOC) as typeof DOC;
    const bookmark = EXPECTED.content[2] as { attrs: Record<string, unknown> };
    delete bookmark.attrs.image;
    expect(out).toEqual(EXPECTED);

    // Belt-and-suspenders on the load-bearing attrs, including that `image`
    // round-trips to its null default (the renderer reads it as null either way).
    const str = JSON.stringify(out);
    expect(str).toContain('"provider":"youtube"');
    expect(str).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(str).toContain('"url":"https://example.com"');
    expect(str).toContain('a^2+b^2=c^2');
    expect(str).toContain('"syncedBlockId":"sb-1"');
    // backslash-bearing latex: assert on the parsed value, not the escaped string.
    expect(mathNodeAt(out, 4)?.latex).toBe('\\int_0^1 x\\,dx');
    // bookmark.image's schema default is null, which is why a null image is not
    // re-emitted above — confirm that is the reason, not an accidental drop.
    expect(schema.nodes.bookmark?.spec.attrs?.image?.default ?? null).toBeNull();
  });
});
