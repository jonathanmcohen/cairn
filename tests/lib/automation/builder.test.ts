import { describe, expect, it } from 'vitest';
import {
  type BuilderModel,
  type ConditionGroupModel,
  compileBuilder,
  decompileRule,
  emptyBuilder,
} from '@/lib/automation/builder';

function group(
  logic: 'and' | 'or',
  children: ConditionGroupModel['children'],
): ConditionGroupModel {
  return { id: 'g', logic, children };
}

describe('compileBuilder', () => {
  it('empty builder compiles to match-all condition + first action', () => {
    const model: BuilderModel = {
      triggerEvent: 'row.created',
      conditions: group('and', []),
      actions: [{ id: 'a1', type: 'notify', config: { userId: 'u1' } }],
    };
    const res = compileBuilder('My rule', model);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.body.condition).toEqual({});
    expect(res.body.conditionTree).toEqual({ logic: 'and', children: [] });
    expect(res.body.triggerEvent).toBe('row.created');
    expect(res.body.actionType).toBe('notify');
    expect(res.body.actionConfig).toEqual({ userId: 'u1' });
  });

  it('single condition row compiles to the singular dispatcher condition', () => {
    const model: BuilderModel = {
      triggerEvent: 'row.updated',
      conditions: group('and', [
        { id: 'c1', field: 'row.cells.status', op: 'equals', value: 'Done' },
      ]),
      actions: [{ id: 'a1', type: 'notify', config: { userId: 'u1', message: 'hi' } }],
    };
    const res = compileBuilder('r', model);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.body.condition).toEqual({
      property: 'row.cells.status',
      operator: 'equals',
      value: 'Done',
    });
  });

  it('validates notify requires userId', () => {
    const model: BuilderModel = {
      triggerEvent: 'row.created',
      conditions: group('and', []),
      actions: [{ id: 'a1', type: 'notify', config: {} }],
    };
    const res = compileBuilder('r', model);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected fail');
    expect(res.error).toMatch(/user/i);
  });

  it('validates set_property requires databaseId + propertyId + value key', () => {
    const model: BuilderModel = {
      triggerEvent: 'row.updated',
      conditions: group('and', []),
      actions: [{ id: 'a1', type: 'set_property', config: { databaseId: 'd', propertyId: 'p' } }],
    };
    const res = compileBuilder('r', model);
    expect(res.ok).toBe(false);
  });

  it('rejects empty rule name', () => {
    const res = compileBuilder('  ', emptyBuilder('row.created'));
    expect(res.ok).toBe(false);
  });

  it('emptyBuilder seeds one notify action and an empty AND group', () => {
    const m = emptyBuilder('page.created');
    expect(m.triggerEvent).toBe('page.created');
    expect(m.conditions.logic).toBe('and');
    expect(m.conditions.children).toHaveLength(0);
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0]?.type).toBe('notify');
  });
});

describe('compileBuilder v0.9.8 — tree + ordered actions', () => {
  it('compiles a nested AND/OR group into conditionTree', () => {
    const model = {
      triggerEvent: 'row.created' as const,
      conditions: {
        id: 'g',
        logic: 'and' as const,
        children: [
          {
            id: 'g2',
            logic: 'or' as const,
            children: [
              { id: 'c1', field: 'row.cells.status', op: 'equals' as const, value: 'Done' },
              { id: 'c2', field: 'row.cells.status', op: 'equals' as const, value: 'Archived' },
            ],
          },
          { id: 'c3', field: 'row.cells.priority', op: 'equals' as const, value: 'High' },
        ],
      },
      actions: [
        { id: 'a1', type: 'notify' as const, config: { userId: 'u1' } },
        { id: 'a2', type: 'send_webhook' as const, config: { webhookId: 'w1' } },
      ],
    };
    const result = compileBuilder('Multi', model);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.conditionTree).toEqual({
      logic: 'and',
      children: [
        {
          logic: 'or',
          children: [
            { field: 'row.cells.status', op: 'equals', value: 'Done' },
            { field: 'row.cells.status', op: 'equals', value: 'Archived' },
          ],
        },
        { field: 'row.cells.priority', op: 'equals', value: 'High' },
      ],
    });
    expect(result.body.actions).toHaveLength(2);
    expect(result.body.actions[0]).toEqual({
      type: 'notify',
      config: { userId: 'u1' },
      sortOrder: 0,
    });
    expect(result.body.actions[1]).toEqual({
      type: 'send_webhook',
      config: { webhookId: 'w1' },
      sortOrder: 1,
    });
    // Singular back-compat fields still populated from the first leaf/action.
    expect(result.body.actionType).toBe('notify');
  });

  it('rejects a tree deeper than the depth cap', () => {
    // biome-ignore lint/suspicious/noExplicitAny: building an over-deep nested group for the guard
    let g: any = {
      id: 'c',
      logic: 'and',
      children: [{ id: 'c', field: 'row.id', op: 'equals', value: 'x' }],
    };
    for (let i = 0; i < 7; i++) g = { id: 'g', logic: 'and', children: [g] };
    const result = compileBuilder('Deep', {
      triggerEvent: 'row.created',
      conditions: g,
      actions: [{ id: 'a1', type: 'notify', config: { userId: 'u1' } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/deep/i);
  });
});

describe('decompileRule', () => {
  it('reverses a singular rule with no condition', () => {
    const m = decompileRule({
      triggerEvent: 'row.created',
      condition: {},
      actionType: 'notify',
      actionConfig: { userId: 'u1', message: 'hi' },
      builder: null,
    });
    expect(m.triggerEvent).toBe('row.created');
    expect(m.conditions.children).toHaveLength(0);
    expect(m.actions[0]?.type).toBe('notify');
    expect(m.actions[0]?.config).toEqual({ userId: 'u1', message: 'hi' });
  });

  it('reverses a singular rule with a condition into one AND leaf', () => {
    const m = decompileRule({
      triggerEvent: 'row.updated',
      condition: { property: 'row.cells.status', operator: 'equals', value: 'Done' },
      actionType: 'set_property',
      actionConfig: { databaseId: 'd', propertyId: 'p', value: 'x' },
      builder: null,
    });
    expect(m.conditions.logic).toBe('and');
    expect(m.conditions.children).toHaveLength(1);
    const leaf = m.conditions.children[0];
    expect(leaf && 'field' in leaf ? leaf.field : null).toBe('row.cells.status');
    expect(leaf && 'op' in leaf ? leaf.op : null).toBe('equals');
  });

  it('prefers the stored builder blob when present (round-trips richer state)', () => {
    const stored = {
      triggerEvent: 'page.created' as const,
      conditions: { id: 'g', logic: 'or' as const, children: [] },
      actions: [{ id: 'a1', type: 'notify' as const, config: { userId: 'u9' } }],
    } satisfies BuilderModel;
    const m = decompileRule({
      triggerEvent: 'page.created',
      condition: {},
      actionType: 'notify',
      actionConfig: { userId: 'u9' },
      builder: stored,
    });
    expect(m.conditions.logic).toBe('or');
    expect(m.actions[0]?.config).toEqual({ userId: 'u9' });
  });
});
