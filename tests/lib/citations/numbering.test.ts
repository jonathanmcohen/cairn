import { describe, expect, it } from 'vitest';
import { numberCitations, numberFootnotes } from '@/lib/citations/numbering';

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

// v0.10.2 P5 — chip numbering must mirror aggregateCitations() (the
// bibliography's dedup'd first-appearance order) so chip [n] always points at
// bibliography entry n.
describe('numberCitations', () => {
  const cite = (id: string | null) => ({ type: 'citation', attrs: { id } });

  it('assigns 1..N in document order', () => {
    const doc = {
      type: 'doc',
      content: [cite('a'), { type: 'paragraph' }, cite('b')],
    };
    const { map, ordered } = numberCitations(doc);
    expect(map).toEqual({ a: 1, b: 2 });
    expect(ordered).toEqual([
      { number: 1, id: 'a' },
      { number: 2, id: 'b' },
    ]);
  });

  it('dedups repeat citations of the same id (both get the same number)', () => {
    const doc = { type: 'doc', content: [cite('a'), cite('b'), cite('a')] };
    const { map, ordered } = numberCitations(doc);
    expect(map).toEqual({ a: 1, b: 2 });
    expect(ordered).toHaveLength(2);
  });

  it('walks nested block content and skips id-less citations', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'blockquote', content: [cite('x')] }, cite(null), cite('y')],
    };
    const { map } = numberCitations(doc);
    expect(map).toEqual({ x: 1, y: 2 });
  });
});
