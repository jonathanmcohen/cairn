// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { turnInto } from '@/components/editor/block-convert';
import { baseExtensions } from '@/components/editor/extensions';

function collabEditor(ydoc: Y.Doc) {
  return new Editor({
    extensions: [
      ...baseExtensions({ undoRedo: false }),
      Collaboration.configure({ document: ydoc }),
    ],
  });
}

describe('turnInto Yjs round-trip audit', () => {
  it('a paragraph→heading conversion syncs to a second doc with identical JSON', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = collabEditor(docA);

    // seed content on A
    a.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sync me' }] }],
    });

    // propagate initial state to B
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = collabEditor(docB);

    // convert on A
    a.commands.setTextSelection(2);
    expect(turnInto(a, 'heading', { level: 1 })).toBe(true);

    // propagate the conversion update A → B
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // both editors agree, and the node really converted
    expect(a.getJSON().content?.[0]?.type).toBe('heading');
    expect(b.getJSON()).toEqual(a.getJSON());

    a.destroy();
    b.destroy();
  });

  it('a list wrap conversion also round-trips identically', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = collabEditor(docA);
    a.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'listy' }] }],
    });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = collabEditor(docB);

    a.commands.setTextSelection(2);
    expect(turnInto(a, 'bulletList')).toBe(true);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(a.getJSON().content?.[0]?.type).toBe('bulletList');
    expect(b.getJSON()).toEqual(a.getJSON());
    a.destroy();
    b.destroy();
  });
});
