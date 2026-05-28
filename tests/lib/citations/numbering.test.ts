import { describe, expect, it } from 'vitest';
import { numberFootnotes } from '@/lib/citations/numbering';

describe('numberFootnotes', () => {
  it('assigns 1..N in document order', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a',
              marks: [{ type: 'footnote', attrs: { id: 'f1', content: 'first' } }],
            },
            {
              type: 'text',
              text: 'b',
              marks: [{ type: 'footnote', attrs: { id: 'f2', content: 'second' } }],
            },
          ],
        },
      ],
    };
    const { map, ordered } = numberFootnotes(doc);
    expect(map).toEqual({ f1: 1, f2: 2 });
    expect(ordered).toEqual([
      { number: 1, id: 'f1', content: 'first' },
      { number: 2, id: 'f2', content: 'second' },
    ]);
  });

  it('dedups repeat references to the same footnote id', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a',
              marks: [{ type: 'footnote', attrs: { id: 'f1', content: 'first' } }],
            },
            {
              type: 'text',
              text: 'b',
              marks: [{ type: 'footnote', attrs: { id: 'f1', content: 'first' } }],
            },
            {
              type: 'text',
              text: 'c',
              marks: [{ type: 'footnote', attrs: { id: 'f2', content: 'second' } }],
            },
          ],
        },
      ],
    };
    const { map, ordered } = numberFootnotes(doc);
    expect(map).toEqual({ f1: 1, f2: 2 });
    expect(ordered).toHaveLength(2);
  });
});
