import { describe, expect, it } from 'vitest';
import { combineWithRrf } from '@/lib/pages/search';

describe('combineWithRrf', () => {
  it('returns both ids when symmetrically ranked across two lists', () => {
    const fts = [
      { id: 'a', rank: 1 },
      { id: 'b', rank: 2 },
    ];
    const semantic = [
      { id: 'b', rank: 1 },
      { id: 'a', rank: 2 },
    ];
    const merged = combineWithRrf([fts, semantic]);
    // a's rrf = 1/(60+1) + 1/(60+2) = 1/61 + 1/62
    // b's rrf = 1/(60+2) + 1/(60+1) = 1/62 + 1/61
    // tied — sort is stable on id ascending in the combiner
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('boosts pages present in BOTH rankings over either alone', () => {
    const fts = [
      { id: 'in_both', rank: 1 },
      { id: 'fts_only', rank: 2 },
    ];
    const semantic = [
      { id: 'in_both', rank: 1 },
      { id: 'sem_only', rank: 2 },
    ];
    const merged = combineWithRrf([fts, semantic]);
    expect(merged[0]?.id).toBe('in_both');
    // in_both: 2/(60+1) ≈ 0.0328
    // fts_only: 1/(60+2) ≈ 0.0161
    // sem_only: 1/(60+2) ≈ 0.0161
    expect(merged[0]?.rrfScore).toBeGreaterThan(merged[1]?.rrfScore ?? 0);
  });

  it('respects a custom k constant', () => {
    const a = combineWithRrf([[{ id: 'x', rank: 1 }]], { k: 60 });
    const b = combineWithRrf([[{ id: 'x', rank: 1 }]], { k: 0 });
    // k=0 produces 1/(0+1)=1; k=60 produces 1/61. Higher score with k=0.
    expect((b[0]?.rrfScore ?? 0) > (a[0]?.rrfScore ?? 0)).toBe(true);
  });

  it('handles an empty input as an empty output', () => {
    expect(combineWithRrf([])).toEqual([]);
    expect(combineWithRrf([[], []])).toEqual([]);
  });

  it('drops ids that appear past the limit (if limit is given)', () => {
    const fts = [
      { id: 'a', rank: 1 },
      { id: 'b', rank: 2 },
      { id: 'c', rank: 3 },
    ];
    const merged = combineWithRrf([fts], { limit: 2 });
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
  });
});
