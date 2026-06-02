// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import { blockActions } from '@/components/editor/use-block-actions';

let editor: Editor;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: baseExtensions({ undoRedo: true }),
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    },
  });
});

afterEach(() => {
  editor.destroy();
  host.remove();
});

function paragraphTexts() {
  return editor.state.doc.content.content.map((n) => n.textContent);
}

// position inside the second paragraph (doc=0, para1 [0..5), para2 starts at 5).
const posOfSecond = 6;

describe('blockActions (#271)', () => {
  it('exposes the action functions', () => {
    const a = blockActions(editor, posOfSecond);
    expect(typeof a.moveUp).toBe('function');
    expect(typeof a.moveDown).toBe('function');
    expect(typeof a.duplicate).toBe('function');
    expect(typeof a.delete).toBe('function');
    expect(typeof a.insertBelow).toBe('function');
  });

  it('duplicate adds a copy of the target block', () => {
    blockActions(editor, posOfSecond).duplicate();
    expect(paragraphTexts()).toEqual(['one', 'two', 'two']);
  });

  it('delete removes the target block', () => {
    blockActions(editor, posOfSecond).delete();
    expect(paragraphTexts()).toEqual(['one']);
  });

  it('moveUp reorders the target above its previous sibling', () => {
    blockActions(editor, posOfSecond).moveUp();
    expect(paragraphTexts()).toEqual(['two', 'one']);
  });
});
