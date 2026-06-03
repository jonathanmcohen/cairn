// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeCommentText } from '@/components/comments/comment-composer';
import { MentionExtension } from '@/components/editor/mention-extension';

// MentionExtension's suggestion fetches members on mount of its plugin view,
// but we never open the popup here; stub fetch defensively anyway.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, json: async () => ({ members: [] }) })) as unknown as typeof fetch,
);

afterEach(() => vi.clearAllMocks());

const MENTION_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Build an editor configured exactly like CommentComposer, insert a mention
 * node followed by trailing text (the same shape mention-extension.ts#command
 * produces), and assert the composer's text serializer keeps BOTH the mention
 * storage token AND the trailing text. Plain `editor.getText()` drops the
 * mention atom (its default serialization is empty) — `serializeCommentText`
 * supplies the `mention` textSerializer that fixes #73/#253.
 */
function buildEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      MentionExtension,
      Placeholder.configure({ placeholder: 'Add a comment…' }),
    ],
    content: '',
  });
}

describe('comment composer mention serialization (#73 #253)', () => {
  it('serializeCommentText keeps the mention token and the trailing text', () => {
    const editor = buildEditor();
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'mention', attrs: { id: MENTION_ID, label: 'Jon' } },
        { type: 'text', text: ' and the rest' },
      ])
      .run();

    const serialized = serializeCommentText(editor);
    expect(serialized).toContain(`@[Jon](${MENTION_ID})`);
    expect(serialized).toContain('and the rest');
    expect(serialized).toBe(`@[Jon](${MENTION_ID}) and the rest`);

    editor.destroy();
  });
});
