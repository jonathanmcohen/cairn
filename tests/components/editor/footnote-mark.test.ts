// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { FootnoteMark } from '@/components/editor/blocks/footnote-mark';

describe('FootnoteMark', () => {
  it('roundtrips through JSON', () => {
    const editor = new Editor({ extensions: [StarterKit, FootnoteMark] });
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
