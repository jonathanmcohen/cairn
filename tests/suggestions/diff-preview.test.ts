import { describe, expect, it } from 'vitest';
import { computeDiffPreview } from '@/lib/suggestions/diff-preview';
import type { Json } from '@/lib/suggestions/transform';

const mark = (type: string, suggestionId: string) => ({ type, attrs: { suggestionId } });
const text = (t: string, marks?: { type: string; attrs?: Record<string, unknown> }[]): Json => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const para = (...content: Json[]): Json => ({ type: 'paragraph', content });
const doc = (...content: Json[]): Json => ({ type: 'doc', content });

describe('computeDiffPreview', () => {
  it('returns inserted text for an insert-only suggestion', () => {
    const d = doc(para(text('keep '), text('added', [mark('suggestionInsert', 's1')])));
    expect(computeDiffPreview(d, 's1')).toEqual({ deleted: '', inserted: 'added' });
  });

  it('returns deleted text for a delete-only suggestion', () => {
    const d = doc(para(text('gone', [mark('suggestionDelete', 's1')]), text(' stays')));
    expect(computeDiffPreview(d, 's1')).toEqual({ deleted: 'gone', inserted: '' });
  });

  it('returns both halves for a replace and ignores other ids', () => {
    const d = doc(
      para(
        text('old', [mark('suggestionDelete', 's1')]),
        text('new', [mark('suggestionInsert', 's1')]),
        text('elsewhere', [mark('suggestionInsert', 's2')]),
      ),
    );
    expect(computeDiffPreview(d, 's1')).toEqual({ deleted: 'old', inserted: 'new' });
  });

  it('concatenates marked text across multiple nodes in document order', () => {
    const d = doc(
      para(text('a', [mark('suggestionInsert', 's1')])),
      para(text('b', [mark('suggestionInsert', 's1')])),
    );
    expect(computeDiffPreview(d, 's1')).toEqual({ deleted: '', inserted: 'ab' });
  });

  it('returns empty strings for an unknown id', () => {
    const d = doc(para(text('x', [mark('suggestionInsert', 's1')])));
    expect(computeDiffPreview(d, 'nope')).toEqual({ deleted: '', inserted: '' });
  });
});
