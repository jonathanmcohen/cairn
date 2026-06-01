import { describe, expect, it } from 'vitest';
import { flatConditionToTree } from '@/lib/automation/condition-tree-backfill';

describe('flatConditionToTree', () => {
  it('empty match-all condition becomes an empty AND group', () => {
    expect(flatConditionToTree({})).toEqual({ logic: 'and', children: [] });
  });

  it('a single flat condition becomes one implicit AND group with one leaf', () => {
    expect(
      flatConditionToTree({ property: 'row.cells.status', operator: 'equals', value: 'Done' }),
    ).toEqual({
      logic: 'and',
      children: [{ field: 'row.cells.status', op: 'equals', value: 'Done' }],
    });
  });
});
