import { describe, expect, it } from 'vitest';
import { aggregateColumn, type CalcFn, computeCalcFooter } from '@/lib/databases/calc-footer';

describe('aggregateColumn', () => {
  it('count: counts every value regardless of blank', () => {
    expect(aggregateColumn([1, null, 3, '', 5], 'count', 'number')).toEqual({
      fn: 'count',
      value: 5,
    });
  });

  it('filled / empty: count non-blank vs blank cells', () => {
    const vals = [1, null, '', 'x', undefined];
    expect(aggregateColumn(vals, 'filled', 'text').value).toBe(2);
    expect(aggregateColumn(vals, 'empty', 'text').value).toBe(3);
  });

  it('sum / avg over numeric cells, ignoring non-numeric/blank', () => {
    const vals = [2, 4, '6', null, 'nope'];
    expect(aggregateColumn(vals, 'sum', 'number').value).toBe(12); // 2+4+6
    expect(aggregateColumn(vals, 'avg', 'number').value).toBe(4); // 12/3
  });

  it('min / max over numeric cells', () => {
    const vals = [9, 3, 7];
    expect(aggregateColumn(vals, 'min', 'number').value).toBe(3);
    expect(aggregateColumn(vals, 'max', 'number').value).toBe(9);
  });

  it('sum/avg/min/max return null when no numeric cells exist', () => {
    for (const fn of ['sum', 'avg', 'min', 'max'] as CalcFn[]) {
      expect(aggregateColumn(['a', null, ''], fn, 'text').value).toBeNull();
    }
  });
});

describe('computeCalcFooter', () => {
  const properties = [
    { id: 'p_name', type: 'text' },
    { id: 'p_score', type: 'number' },
  ];
  const rows = [
    { row: { id: 'r1' }, cells: { p_name: 'a', p_score: 10 } },
    { row: { id: 'r2' }, cells: { p_name: '', p_score: 20 } },
    { row: { id: 'r3' }, cells: { p_name: 'c', p_score: null } },
  ];

  it('computes only the configured columns', () => {
    const out = computeCalcFooter(rows, properties, {
      p_score: 'sum',
      p_name: 'filled',
    });
    expect(out.p_score).toEqual({ fn: 'sum', value: 30 });
    expect(out.p_name).toEqual({ fn: 'filled', value: 2 });
  });

  it('skips columns with no configured function and unknown property ids', () => {
    const out = computeCalcFooter(rows, properties, { p_missing: 'count' });
    expect(out.p_name).toBeUndefined();
    expect(out.p_missing).toBeUndefined();
  });

  it('returns {} when calcConfig is empty/undefined', () => {
    expect(computeCalcFooter(rows, properties, {})).toEqual({});
    expect(computeCalcFooter(rows, properties, undefined)).toEqual({});
  });
});
