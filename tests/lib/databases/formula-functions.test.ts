import { describe, expect, it } from 'vitest';
import { FORMULA_FUNCTIONS } from '@/lib/databases/formula/functions';

const call = (name: string, ...args: unknown[]) => {
  const fn = FORMULA_FUNCTIONS[name];
  if (!fn) throw new Error(`no fn ${name}`);
  return fn(args);
};

describe('FORMULA_FUNCTIONS', () => {
  it('if(cond, a, b) picks by truthiness', () => {
    expect(call('if', true, 'yes', 'no')).toBe('yes');
    expect(call('if', false, 'yes', 'no')).toBe('no');
    expect(call('if', 0, 'yes', 'no')).toBe('no');
  });

  it('concat joins stringified args', () => {
    expect(call('concat', 'a', 1, true)).toBe('a1true');
    expect(call('concat')).toBe('');
  });

  it('length of a string', () => {
    expect(call('length', 'hello')).toBe(5);
    expect(call('length', '')).toBe(0);
  });

  it('round / abs', () => {
    expect(call('round', 2.4)).toBe(2);
    expect(call('round', 2.6)).toBe(3);
    expect(call('abs', -7)).toBe(7);
  });

  it('min / max / sum over args', () => {
    expect(call('min', 3, 1, 2)).toBe(1);
    expect(call('max', 3, 1, 2)).toBe(3);
    expect(call('sum', 1, 2, 3)).toBe(6);
    expect(call('sum')).toBe(0);
  });

  it('now() returns a Date', () => {
    expect(call('now')).toBeInstanceOf(Date);
  });

  it('dateDiff(a, b, unit) in days', () => {
    const a = '2026-01-10T00:00:00.000Z';
    const b = '2026-01-01T00:00:00.000Z';
    expect(call('dateDiff', a, b, 'days')).toBe(9);
    expect(call('dateDiff', b, a, 'days')).toBe(-9);
  });

  it('dateDiff supports hours and minutes', () => {
    const a = '2026-01-01T05:00:00.000Z';
    const b = '2026-01-01T00:00:00.000Z';
    expect(call('dateDiff', a, b, 'hours')).toBe(5);
    expect(call('dateDiff', a, b, 'minutes')).toBe(300);
  });
});
