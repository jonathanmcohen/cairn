import { describe, expect, it } from 'vitest';
import { collectHeadings, headingSlug } from '@/lib/editor/headings';

function heading(level: number, text: string) {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

describe('headingSlug', () => {
  it('slugifies text to a url-safe id', () => {
    expect(headingSlug('Hello, World!')).toBe('hello-world');
    expect(headingSlug('  Trim   Me  ')).toBe('trim-me');
    expect(headingSlug('Café déjà 42')).toBe('caf-dj-42');
  });
  it('falls back to "section" for empty/symbol-only text', () => {
    expect(headingSlug('')).toBe('section');
    expect(headingSlug('!!!')).toBe('section');
  });
});

describe('collectHeadings', () => {
  it('returns headings in document order with level + text', () => {
    const doc = {
      type: 'doc',
      content: [
        heading(1, 'Intro'),
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        heading(2, 'Details'),
        heading(3, 'Sub'),
      ],
    };
    const out = collectHeadings(doc);
    expect(out).toEqual([
      { level: 1, text: 'Intro', id: 'intro' },
      { level: 2, text: 'Details', id: 'details' },
      { level: 3, text: 'Sub', id: 'sub' },
    ]);
  });

  it('concatenates rich heading text (multiple text nodes)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [
            { type: 'text', text: 'Part ' },
            { type: 'text', text: 'Two' },
          ],
        },
      ],
    };
    expect(collectHeadings(doc)).toEqual([{ level: 1, text: 'Part Two', id: 'part-two' }]);
  });

  it('dedupes colliding slugs with a numeric suffix', () => {
    const doc = {
      type: 'doc',
      content: [heading(1, 'Notes'), heading(2, 'Notes'), heading(2, 'Notes')],
    };
    expect(collectHeadings(doc).map((h) => h.id)).toEqual(['notes', 'notes-1', 'notes-2']);
  });

  it('walks nested containers (callout/column children)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          content: [heading(2, 'Inside')],
        },
      ],
    };
    expect(collectHeadings(doc)).toEqual([{ level: 2, text: 'Inside', id: 'inside' }]);
  });

  it('returns [] for an empty or contentless doc', () => {
    expect(collectHeadings({ type: 'doc' })).toEqual([]);
    expect(collectHeadings({ type: 'doc', content: [] })).toEqual([]);
    expect(collectHeadings(null)).toEqual([]);
  });
});
