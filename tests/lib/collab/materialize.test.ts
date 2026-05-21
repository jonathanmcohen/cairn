import { Node as PMNode } from 'prosemirror-model';
import { schema } from 'prosemirror-schema-basic';
import { describe, expect, it } from 'vitest';
import { prosemirrorToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { yjsStateToProseDoc } from '@/lib/collab/materialize';

describe('yjsStateToProseDoc', () => {
  it('round-trips a tiny doc to ProseMirror JSON', () => {
    // Build a ProseMirror doc, encode it into a Y.Doc, snapshot the state, then materialize.
    const pmDoc = PMNode.fromJSON(schema, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello collab' }] }],
    });
    const ydoc = prosemirrorToYDoc(pmDoc, 'default');
    const state = Y.encodeStateAsUpdate(ydoc);

    const json = yjsStateToProseDoc(state, schema, 'default');
    expect(json.type).toBe('doc');
    expect(JSON.stringify(json)).toContain('hello collab');
  });

  it('returns an empty doc for empty state', () => {
    const ydoc = new Y.Doc();
    const state = Y.encodeStateAsUpdate(ydoc);
    const json = yjsStateToProseDoc(state, schema, 'default');
    expect(json.type).toBe('doc');
  });
});
