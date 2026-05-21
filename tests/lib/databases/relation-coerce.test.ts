import { describe, expect, it } from 'vitest';
import { coerce } from '@/lib/databases/rows';

describe('coerce relation', () => {
  it('normalizes a string[] of ids', () => {
    expect(coerce('relation', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('dedupes ids', () => {
    expect(coerce('relation', ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('drops non-string entries and trims', () => {
    expect(coerce('relation', ['a', 1, null, '  c  ', ''])).toEqual(['a', 'c']);
  });

  it('returns [] for non-array input', () => {
    expect(coerce('relation', 'a')).toEqual([]);
    expect(coerce('relation', 42)).toEqual([]);
  });

  it('returns null for null/undefined', () => {
    expect(coerce('relation', null)).toBeNull();
    expect(coerce('relation', undefined)).toBeNull();
  });
});
