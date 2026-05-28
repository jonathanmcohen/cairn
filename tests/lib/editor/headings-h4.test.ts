import { describe, expect, it } from 'vitest';
import { collectHeadings, headingSlug } from '@/lib/editor/headings';

const doc = (children: unknown[]) => ({ type: 'doc', content: children });
const heading = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

describe('collectHeadings — h4 support', () => {
  it('includes h4 entries in document order', () => {
    const result = collectHeadings(
      doc([heading(1, 'One'), heading(2, 'Two'), heading(3, 'Three'), heading(4, 'Four')]),
    );
    expect(result.map((h) => ({ level: h.level, text: h.text }))).toEqual([
      { level: 1, text: 'One' },
      { level: 2, text: 'Two' },
      { level: 3, text: 'Three' },
      { level: 4, text: 'Four' },
    ]);
  });

  it('ignores levels above 4', () => {
    const result = collectHeadings(
      doc([heading(1, 'Keep'), heading(5, 'Drop'), heading(6, 'Drop')]),
    );
    expect(result.map((h) => h.text)).toEqual(['Keep']);
  });

  it('headingSlug produces stable slug for h4 text', () => {
    expect(headingSlug('Section Four')).toBe('section-four');
  });

  it('deduplicates identical h4 slugs with a numeric suffix', () => {
    const result = collectHeadings(
      doc([heading(4, 'Notes'), heading(4, 'Notes'), heading(4, 'Notes')]),
    );
    const ids = result.map((h) => h.id);
    expect(new Set(ids).size).toBe(3);
  });
});
