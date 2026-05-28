// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PdfNode } from '@/components/editor/blocks/pdf-node';

// Track + destroy editors so prosemirror-view's DOMObserver doesn't schedule a
// deferred flush (setTimeout) that fires after vitest tears down jsdom — that
// throws an uncaught `ReferenceError: document is not defined` which fails the
// whole run even though every assertion passed. Same fix as audio-node.test.tsx.
const editors: Editor[] = [];
const makeEditor = (opts: ConstructorParameters<typeof Editor>[0]) => {
  const e = new Editor(opts);
  editors.push(e);
  return e;
};

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

describe('PdfNode schema', () => {
  it('declares the `pdf` node name, block group, atom', () => {
    expect(PdfNode.name).toBe('pdf');
    expect(PdfNode.config.group).toBe('block');
    expect(PdfNode.config.atom).toBe(true);
  });

  it('serializes + parses through JSON roundtrip preserving fileId + defaultPage', () => {
    const editor = makeEditor({ extensions: [StarterKit, PdfNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'pdf', attrs: { fileId: 'file-123', defaultPage: 3 } }],
    });
    const json = editor.getJSON();
    const node = json.content?.[0];
    expect(node?.type).toBe('pdf');
    expect(node?.attrs?.fileId).toBe('file-123');
    expect(node?.attrs?.defaultPage).toBe(3);
  });

  it('defaults defaultPage to 1 and fileId to null', () => {
    const editor = makeEditor({ extensions: [StarterKit, PdfNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'pdf', attrs: {} }],
    });
    const node = editor.getJSON().content?.[0];
    expect(node?.attrs?.defaultPage).toBe(1);
    expect(node?.attrs?.fileId).toBe(null);
  });
});

describe('PdfNode Yjs roundtrip', () => {
  it('persists fileId through Yjs', () => {
    const docA = new Y.Doc();
    docA.getMap('pdf').set('fileId', 'file-abc');
    docA.getMap('pdf').set('defaultPage', 4);
    const update = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, update);
    expect(docB.getMap('pdf').get('fileId')).toBe('file-abc');
    expect(docB.getMap('pdf').get('defaultPage')).toBe(4);
  });
});
