import { describe, expect, it } from 'vitest';
import {
  type ConditionTree,
  evaluateConditionTree,
  MAX_CONDITION_TREE_DEPTH,
} from '@/lib/automation/condition-tree';

const payload = { row: { cells: { status: 'Done', priority: 'High', count: 5 } } };

function leaf(property: string, value: unknown) {
  return { field: property, op: 'equals' as const, value };
}

describe('evaluateConditionTree', () => {
  it('empty group (no children) matches everything', () => {
    expect(evaluateConditionTree({ logic: 'and', children: [] }, payload)).toBe(true);
    expect(evaluateConditionTree({ logic: 'or', children: [] }, payload)).toBe(true);
  });

  it('AND truth table', () => {
    const t: ConditionTree = {
      logic: 'and',
      children: [leaf('row.cells.status', 'Done'), leaf('row.cells.priority', 'High')],
    };
    expect(evaluateConditionTree(t, payload)).toBe(true);
    expect(
      evaluateConditionTree(
        {
          logic: 'and',
          children: [leaf('row.cells.status', 'Done'), leaf('row.cells.priority', 'Low')],
        },
        payload,
      ),
    ).toBe(false);
  });

  it('OR truth table', () => {
    expect(
      evaluateConditionTree(
        {
          logic: 'or',
          children: [leaf('row.cells.status', 'Open'), leaf('row.cells.priority', 'High')],
        },
        payload,
      ),
    ).toBe(true);
    expect(
      evaluateConditionTree(
        {
          logic: 'or',
          children: [leaf('row.cells.status', 'Open'), leaf('row.cells.priority', 'Low')],
        },
        payload,
      ),
    ).toBe(false);
  });

  it('nested group: (status=Done OR priority=Low) AND priority=High', () => {
    const t: ConditionTree = {
      logic: 'and',
      children: [
        {
          logic: 'or',
          children: [leaf('row.cells.status', 'Done'), leaf('row.cells.priority', 'Low')],
        },
        leaf('row.cells.priority', 'High'),
      ],
    };
    expect(evaluateConditionTree(t, payload)).toBe(true);
  });

  it('uses leaf operators (gt) identically to evaluateCondition', () => {
    const t: ConditionTree = {
      logic: 'and',
      children: [{ field: 'row.cells.count', op: 'gt', value: 3 }],
    };
    expect(evaluateConditionTree(t, payload)).toBe(true);
  });

  it('throws past the depth cap', () => {
    // Build a chain one level deeper than the cap.
    let node: ConditionTree = { logic: 'and', children: [leaf('row.cells.status', 'Done')] };
    for (let i = 0; i < MAX_CONDITION_TREE_DEPTH + 1; i++) {
      node = { logic: 'and', children: [node] };
    }
    expect(() => evaluateConditionTree(node, payload)).toThrow(/depth/i);
    expect(MAX_CONDITION_TREE_DEPTH).toBe(5);
  });
});
