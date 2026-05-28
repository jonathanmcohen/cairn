// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { FlashcardNode } from '@/components/editor/blocks/flashcard-node';

describe('FlashcardNode', () => {
  it('roundtrips attrs through JSON', () => {
    const editor = new Editor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'flashcard',
          attrs: { front: 'Q', back: 'A', deckTag: 'spanish', blockId: 'b1' },
        },
      ],
    });
    const node = editor.getJSON().content?.[0];
    expect(node?.type).toBe('flashcard');
    expect(node?.attrs?.front).toBe('Q');
    expect(node?.attrs?.back).toBe('A');
    expect(node?.attrs?.deckTag).toBe('spanish');
    expect(node?.attrs?.blockId).toBe('b1');
  });

  it('setFlashcard command inserts a flashcard node', () => {
    const editor = new Editor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    editor.commands.setFlashcard({ front: 'F', back: 'B', deckTag: null });
    const found = (editor.getJSON().content ?? []).some(
      (n) => (n as { type?: string }).type === 'flashcard',
    );
    expect(found).toBe(true);
  });

  it('renders to HTML with data-* attributes for serialization', () => {
    const editor = new Editor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'flashcard',
          attrs: { front: 'Front', back: 'Back', deckTag: 'tag', blockId: 'b1' },
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain('data-flashcard');
    expect(html).toContain('data-front="Front"');
    expect(html).toContain('data-back="Back"');
    expect(html).toContain('data-deck-tag="tag"');
    expect(html).toContain('data-block-id="b1"');
  });
});
