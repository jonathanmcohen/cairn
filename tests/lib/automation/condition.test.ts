import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '@/lib/automation/condition';

describe('evaluateCondition', () => {
  const payload = {
    row: { id: 'r1', cells: { status: 'Done', count: 5, archived: false, notes: 'hello world' } },
  };

  it('empty condition matches everything', () => {
    expect(evaluateCondition({}, payload)).toBe(true);
  });

  it('equals + not_equals', () => {
    expect(
      evaluateCondition(
        { property: 'row.cells.status', operator: 'equals', value: 'Done' },
        payload,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { property: 'row.cells.status', operator: 'not_equals', value: 'Done' },
        payload,
      ),
    ).toBe(false);
  });

  it('contains + not_contains', () => {
    expect(
      evaluateCondition(
        { property: 'row.cells.notes', operator: 'contains', value: 'world' },
        payload,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { property: 'row.cells.notes', operator: 'not_contains', value: 'world' },
        payload,
      ),
    ).toBe(false);
  });

  it('gt + lt + between for numbers', () => {
    expect(
      evaluateCondition({ property: 'row.cells.count', operator: 'gt', value: 4 }, payload),
    ).toBe(true);
    expect(
      evaluateCondition({ property: 'row.cells.count', operator: 'lt', value: 4 }, payload),
    ).toBe(false);
    expect(
      evaluateCondition(
        { property: 'row.cells.count', operator: 'between', value: [1, 10] },
        payload,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { property: 'row.cells.count', operator: 'between', value: [10, 20] },
        payload,
      ),
    ).toBe(false);
  });

  it('is_empty + is_not_empty', () => {
    expect(
      evaluateCondition(
        { property: 'row.cells.missing', operator: 'is_empty', value: null },
        payload,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { property: 'row.cells.status', operator: 'is_not_empty', value: null },
        payload,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { property: 'row.cells.missing', operator: 'is_not_empty', value: null },
        payload,
      ),
    ).toBe(false);
  });

  it('is_true + is_false', () => {
    expect(
      evaluateCondition(
        { property: 'row.cells.archived', operator: 'is_false', value: null },
        payload,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { property: 'row.cells.archived', operator: 'is_true', value: null },
        payload,
      ),
    ).toBe(false);
  });

  it('unknown property path returns false (not throws)', () => {
    expect(
      evaluateCondition({ property: 'row.cells.nope', operator: 'equals', value: 'x' }, payload),
    ).toBe(false);
  });

  it('unknown operator returns false (defensive)', () => {
    expect(
      evaluateCondition(
        // @ts-expect-error — intentionally invalid operator at runtime.
        { property: 'row.cells.status', operator: 'wat', value: 'x' },
        payload,
      ),
    ).toBe(false);
  });
});
