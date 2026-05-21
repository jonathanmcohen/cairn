import { describe, expect, it } from 'vitest';
import { computeFormula } from '@/lib/databases/formula';

const ctx = {
  // property name -> property id
  nameToId: new Map<string, string>([
    ['Price', 'p1'],
    ['Qty', 'p2'],
    ['Done', 'p3'],
  ]),
  // property id -> resolved cell value
  cells: { p1: 10, p2: 3, p3: true } as Record<string, unknown>,
};

const errMarker = (v: unknown) =>
  typeof v === 'object' && v !== null && '__error' in (v as Record<string, unknown>);

describe('computeFormula', () => {
  it('evaluates literals', () => {
    expect(computeFormula('42', ctx)).toBe(42);
    expect(computeFormula('"hi"', ctx)).toBe('hi');
    expect(computeFormula('true', ctx)).toBe(true);
  });

  it('resolves property references by name', () => {
    expect(computeFormula('Price', ctx)).toBe(10);
    expect(computeFormula('prop("Qty")', ctx)).toBe(3);
  });

  it('does arithmetic with precedence', () => {
    expect(computeFormula('Price + Qty * 2', ctx)).toBe(16);
    expect(computeFormula('(Price + Qty) * 2', ctx)).toBe(26);
    expect(computeFormula('Price % 3', ctx)).toBe(1);
  });

  it('does comparisons', () => {
    expect(computeFormula('Price > 5', ctx)).toBe(true);
    expect(computeFormula('Qty == 3', ctx)).toBe(true);
    expect(computeFormula('Qty != 3', ctx)).toBe(false);
  });

  it('calls functions', () => {
    expect(computeFormula('if(Done, Price, 0)', ctx)).toBe(10);
    expect(computeFormula('concat("$", Price)', ctx)).toBe('$10');
    expect(computeFormula('round(Price / Qty)', ctx)).toBe(3);
  });

  it('returns {__error} for an unknown property', () => {
    const r = computeFormula('Missing + 1', ctx);
    expect(errMarker(r)).toBe(true);
  });

  it('returns {__error} for an unknown function', () => {
    const r = computeFormula('frobnicate(1)', ctx);
    expect(errMarker(r)).toBe(true);
  });

  it('returns {__error} for a parse error, never throws', () => {
    const r = computeFormula('1 +', ctx);
    expect(errMarker(r)).toBe(true);
  });

  it('returns {__error} for division by zero', () => {
    const r = computeFormula('Price / 0', ctx);
    expect(errMarker(r)).toBe(true);
  });
});
