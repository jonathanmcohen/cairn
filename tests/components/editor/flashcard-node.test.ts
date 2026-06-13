// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { FlashcardNode } from '@/components/editor/blocks/flashcard-node';

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

describe('FlashcardNode', () => {
  it('roundtrips attrs through JSON', () => {
    const editor = makeEditor({ extensions: [StarterKit, FlashcardNode] });
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

  it('roundtrips the F2-D cardId + deckId attrs through JSON', () => {
    const editor = makeEditor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'flashcard',
          attrs: {
            front: 'Q',
            back: 'A',
            deckTag: null,
            blockId: 'b1',
            cardId: 'card-123',
            deckId: 'deck-456',
          },
        },
      ],
    });
    const node = editor.getJSON().content?.[0];
    expect(node?.attrs?.cardId).toBe('card-123');
    expect(node?.attrs?.deckId).toBe('deck-456');
  });

  it('defaults cardId + deckId to null when absent', () => {
    const editor = makeEditor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'flashcard', attrs: { front: 'Q', back: 'A' } }],
    });
    const node = editor.getJSON().content?.[0];
    expect(node?.attrs?.cardId).toBeNull();
    expect(node?.attrs?.deckId).toBeNull();
  });

  it('setFlashcard command inserts a flashcard node with a non-empty blockId', () => {
    const editor = makeEditor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    editor.commands.setFlashcard({ front: 'F', back: 'B', deckTag: null });
    const node = (editor.getJSON().content ?? []).find(
      (n) => (n as { type?: string }).type === 'flashcard',
    ) as { attrs?: { blockId?: unknown } } | undefined;
    expect(node).toBeDefined();
    expect(typeof node?.attrs?.blockId).toBe('string');
    expect((node?.attrs?.blockId as string).length).toBeGreaterThan(0);
  });

  it('serializes a non-empty data-block-id for a freshly inserted card', () => {
    const editor = makeEditor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    editor.commands.setFlashcard({ front: 'F', back: 'B', deckTag: null });
    const html = editor.getHTML();
    // data-block-id must NOT be empty (the #115 bug: data-block-id="").
    expect(html).toContain('data-block-id="');
    expect(html).not.toContain('data-block-id=""');
  });

  it('renders to HTML with data-* attributes for serialization', () => {
    const editor = makeEditor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'flashcard',
          attrs: {
            front: 'Front',
            back: 'Back',
            deckTag: 'tag',
            blockId: 'b1',
            cardId: 'c1',
            deckId: 'd1',
          },
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain('data-flashcard');
    expect(html).toContain('data-front="Front"');
    expect(html).toContain('data-back="Back"');
    expect(html).toContain('data-deck-tag="tag"');
    expect(html).toContain('data-block-id="b1"');
    expect(html).toContain('data-card-id="c1"');
    expect(html).toContain('data-deck-id="d1"');
  });

  it('parses data-card-id + data-deck-id back from HTML', () => {
    const editor = makeEditor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent(
      '<div data-flashcard="1" data-front="F" data-back="B" data-block-id="b9" data-card-id="cardZ" data-deck-id="deckZ"></div>',
    );
    const node = editor.getJSON().content?.[0];
    expect(node?.type).toBe('flashcard');
    expect(node?.attrs?.cardId).toBe('cardZ');
    expect(node?.attrs?.deckId).toBe('deckZ');
    expect(node?.attrs?.blockId).toBe('b9');
  });
});
