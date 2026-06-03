import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { baseExtensions } from '@/components/editor/extensions';

/**
 * v0.8.0 P24 divider audit: the new `divider` node — an atomic block rendered
 * as `<hr>` — must survive a ProseMirror schema parse/serialize round-trip AND
 * a Yjs encode/decode with its (empty) attrs intact. This is the same contract
 * the v0.6.0 P5 blocks honour (see tests/lib/editor/blocks-yjs-roundtrip.test.ts).
 */
const schema = getSchema(baseExtensions());
const FIELD = 'default';

// Input document. The paragraph carries no explicit attrs.
const DOC = {
  type: 'doc',
  content: [{ type: 'divider' }, { type: 'paragraph' }],
};

// Expected serialization. v0.9.9 Plan D (#275) registered the TextAlign
// extension over paragraph/heading, which adds a global `textAlign` attr
// (default null) — so a round-tripped paragraph now serializes that attr. The
// divider node is unaffected (atom, no attrs).
const ROUNDTRIPPED = {
  type: 'doc',
  content: [{ type: 'divider' }, { type: 'paragraph', attrs: { textAlign: null } }],
};

describe('v0.8.0 P24 divider block', () => {
  it('parses through the real schema and back, preserving its node type', () => {
    const node = PMNode.fromJSON(schema, DOC);
    const json = node.toJSON();
    expect(JSON.stringify(json)).toContain('"divider"');
    expect(json).toEqual(ROUNDTRIPPED);
  });

  it('encodes to a Y.Doc, applies an update, and decodes with the node intact', () => {
    PMNode.fromJSON(schema, DOC);
    const ydoc = prosemirrorJSONToYDoc(schema, DOC, FIELD);
    const update = Y.encodeStateAsUpdate(ydoc);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, update);
    const out = yDocToProsemirrorJSON(fresh, FIELD) as typeof DOC;
    // The Yjs round-trip omits default-valued attrs (textAlign: null), so the
    // paragraph decodes bare — unlike PMNode.toJSON() above which emits it.
    expect(out).toEqual(DOC);
  });

  it('has a schema spec marked as atom block (so it cannot hold children)', () => {
    const dividerSpec = schema.nodes.divider;
    expect(dividerSpec).toBeDefined();
    expect(dividerSpec?.isAtom).toBe(true);
    expect(dividerSpec?.isBlock).toBe(true);
  });
});
