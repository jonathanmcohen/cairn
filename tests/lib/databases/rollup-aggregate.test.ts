import { describe, expect, it } from 'vitest';
import { aggregate } from '@/lib/databases/rollup/aggregate';

describe('aggregate', () => {
  it('count = number of related rows (incl. nulls/non-numerics)', () => {
    expect(aggregate('count', [1, 2, 3])).toBe(3);
    expect(aggregate('count', [null, 'x', undefined])).toBe(3);
    expect(aggregate('count', [])).toBe(0);
  });

  it('sum over numbers, ignoring non-numerics', () => {
    expect(aggregate('sum', [1, 2, 3])).toBe(6);
    expect(aggregate('sum', [1, 'x', 2, null])).toBe(3);
    expect(aggregate('sum', [])).toBe(0);
    expect(aggregate('sum', ['x', null])).toBe(0);
  });

  it('avg over numbers (ignores non-numerics)', () => {
    expect(aggregate('avg', [2, 4, 6])).toBe(4);
    expect(aggregate('avg', [2, 'x', 6])).toBe(4);
    expect(aggregate('avg', [])).toBeNull();
    expect(aggregate('avg', ['x'])).toBeNull();
  });

  it('min / max over numbers', () => {
    expect(aggregate('min', [3, 1, 2])).toBe(1);
    expect(aggregate('max', [3, 1, 2])).toBe(3);
    expect(aggregate('min', ['x', 5, 'y'])).toBe(5);
    expect(aggregate('min', [])).toBeNull();
    expect(aggregate('max', ['x'])).toBeNull();
  });

  it('coerces numeric strings and booleans', () => {
    expect(aggregate('sum', ['1', '2', true])).toBe(4); // 1 + 2 + 1
    expect(aggregate('max', ['10', 2])).toBe(10);
  });

  it('earliest / latest over dates (ISO strings + Date)', () => {
    const a = '2026-01-01T00:00:00.000Z';
    const b = '2026-06-01T00:00:00.000Z';
    const c = new Date('2026-03-01T00:00:00.000Z');
    expect(aggregate('earliest', [b, a, c])).toBe(a);
    expect(aggregate('latest', [a, c, b])).toBe(b);
  });

  it('earliest / latest ignore unparseable dates', () => {
    const a = '2026-01-01T00:00:00.000Z';
    expect(aggregate('earliest', ['nope', a, ''])).toBe(a);
    expect(aggregate('latest', [a, 'nope'])).toBe(a);
    expect(aggregate('earliest', [])).toBeNull();
    expect(aggregate('latest', ['garbage'])).toBeNull();
  });

  it('returns a normalized ISO string for date fns even when given a Date', () => {
    const c = new Date('2026-03-01T00:00:00.000Z');
    expect(aggregate('earliest', [c])).toBe('2026-03-01T00:00:00.000Z');
  });
});
