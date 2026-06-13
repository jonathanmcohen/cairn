import { describe, expect, it } from 'vitest';
import { applyFlashcardEditToContent } from '@/lib/flashcards/write-through';

const doc = (blockId: string, front = 'Q', back = 'A') => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
    { type: 'flashcard', attrs: { blockId, front, back, deckTag: null } },
    { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
  ],
});

describe('applyFlashcardEditToContent', () => {
  it('updates front/back of the matching block and leaves siblings intact', () => {
    const { found, content } = applyFlashcardEditToContent(doc('b1'), 'b1', {
      front: 'Q2',
      back: 'A2',
    });
    expect(found).toBe(true);
    const node = (content as { content: { type: string; attrs?: Record<string, unknown> }[] })
      .content[1]!;
    expect(node.attrs?.front).toBe('Q2');
    expect(node.attrs?.back).toBe('A2');
    // The paragraphs are untouched.
    const para = (content as { content: { content?: { text: string }[] }[] }).content[0]!;
    expect(para.content?.[0]?.text).toBe('before');
  });

  it('reports found=false when no block matches', () => {
    const { found } = applyFlashcardEditToContent(doc('b1'), 'nope', { front: 'X' });
    expect(found).toBe(false);
  });

  it('does not mutate the input doc (works on a clone)', () => {
    const input = doc('b1', 'orig', 'origBack');
    applyFlashcardEditToContent(input, 'b1', { front: 'changed' });
    const node = input.content[1] as { attrs: { front: string } };
    expect(node.attrs.front).toBe('orig');
  });

  it('only writes the keys provided', () => {
    const { content } = applyFlashcardEditToContent(doc('b1', 'Q', 'A'), 'b1', { front: 'Q2' });
    const node = (content as { content: { attrs?: Record<string, unknown> }[] }).content[1]!;
    expect(node.attrs?.front).toBe('Q2');
    expect(node.attrs?.back).toBe('A'); // unchanged
  });
});
