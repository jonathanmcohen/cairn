// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { FootnoteMark } from '@/components/editor/blocks/footnote-mark';

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

describe('FootnoteMark', () => {
  it('roundtrips through JSON', () => {
    const editor = makeEditor({ extensions: [StarterKit, FootnoteMark] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'hello',
              marks: [{ type: 'footnote', attrs: { id: 'fa', content: 'note' } }],
            },
          ],
        },
      ],
    });
    const m = editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0];
    expect(m?.type).toBe('footnote');
    expect(m?.attrs?.id).toBe('fa');
    expect(m?.attrs?.content).toBe('note');
  });
});
