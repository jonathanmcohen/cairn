import { describe, expect, it } from 'vitest';
import {
  type BuilderModel,
  type ConditionGroup,
  compileBuilder,
  decompileRule,
  emptyBuilder,
} from '@/lib/automation/builder';

function group(combinator: 'and' | 'or', rows: ConditionGroup['rows']): ConditionGroup {
  return { combinator, rows };
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
    expect(res.body.triggerEvent).toBe('row.created');
    expect(res.body.actionType).toBe('notify');
    expect(res.body.actionConfig).toEqual({ userId: 'u1' });
  });

  it('single condition row compiles to the singular dispatcher condition', () => {
    const model: BuilderModel = {
      triggerEvent: 'row.updated',
      conditions: group('and', [
        { id: 'c1', property: 'row.cells.status', operator: 'equals', value: 'Done' },
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

  it('rejects multi-condition AND/OR until dispatcher supports it (forward-compat guard)', () => {
    const model: BuilderModel = {
      triggerEvent: 'row.created',
      conditions: group('or', [
        { id: 'c1', property: 'a', operator: 'equals', value: 1 },
        { id: 'c2', property: 'b', operator: 'equals', value: 2 },
      ]),
      actions: [{ id: 'a1', type: 'notify', config: { userId: 'u1' } }],
    };
    const res = compileBuilder('r', model);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected fail');
    expect(res.error).toMatch(/one condition/i);
  });

  it('rejects multiple actions until chaining is supported', () => {
    const model: BuilderModel = {
      triggerEvent: 'row.created',
      conditions: group('and', []),
      actions: [
        { id: 'a1', type: 'notify', config: { userId: 'u1' } },
        { id: 'a2', type: 'notify', config: { userId: 'u2' } },
      ],
    };
    const res = compileBuilder('r', model);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected fail');
    expect(res.error).toMatch(/one action/i);
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
    expect(m.conditions.combinator).toBe('and');
    expect(m.conditions.rows).toHaveLength(0);
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0]?.type).toBe('notify');
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
    expect(m.conditions.rows).toHaveLength(0);
    expect(m.actions[0]?.type).toBe('notify');
    expect(m.actions[0]?.config).toEqual({ userId: 'u1', message: 'hi' });
  });

  it('reverses a singular rule with a condition into one AND row', () => {
    const m = decompileRule({
      triggerEvent: 'row.updated',
      condition: { property: 'row.cells.status', operator: 'equals', value: 'Done' },
      actionType: 'set_property',
      actionConfig: { databaseId: 'd', propertyId: 'p', value: 'x' },
      builder: null,
    });
    expect(m.conditions.combinator).toBe('and');
    expect(m.conditions.rows).toHaveLength(1);
    expect(m.conditions.rows[0]?.property).toBe('row.cells.status');
    expect(m.conditions.rows[0]?.operator).toBe('equals');
  });

  it('prefers the stored builder blob when present (round-trips richer state)', () => {
    const stored = {
      triggerEvent: 'page.created' as const,
      conditions: { combinator: 'or' as const, rows: [] },
      actions: [{ id: 'a1', type: 'notify' as const, config: { userId: 'u9' } }],
    } satisfies BuilderModel;
    const m = decompileRule({
      triggerEvent: 'page.created',
      condition: {},
      actionType: 'notify',
      actionConfig: { userId: 'u9' },
      builder: stored,
    });
    expect(m.conditions.combinator).toBe('or');
    expect(m.actions[0]?.config).toEqual({ userId: 'u9' });
  });
});
