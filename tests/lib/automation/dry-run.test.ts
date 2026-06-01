import { describe, expect, it } from 'vitest';
import { dryRunRule } from '@/lib/automation/dry-run';

describe('dryRunRule', () => {
  it('reports matched + action summary when condition passes', () => {
    const res = dryRunRule(
      {
        condition: { property: 'row.cells.status', operator: 'equals', value: 'Done' },
        actionType: 'notify',
        actionConfig: { userId: 'u1', message: 'done!' },
      },
      { row: { cells: { status: 'Done' } } },
    );
    expect(res.matched).toBe(true);
    expect(res.status).toBe('would_run');
    expect(res.actionSummary).toMatch(/notify/i);
  });

  it('reports condition_unmet when condition fails', () => {
    const res = dryRunRule(
      {
        condition: { property: 'row.cells.status', operator: 'equals', value: 'Done' },
        actionType: 'notify',
        actionConfig: { userId: 'u1' },
      },
      { row: { cells: { status: 'Todo' } } },
    );
    expect(res.matched).toBe(false);
    expect(res.status).toBe('condition_unmet');
  });

  it('empty condition matches all', () => {
    const res = dryRunRule(
      { condition: {}, actionType: 'notify', actionConfig: { userId: 'u1' } },
      { anything: true },
    );
    expect(res.matched).toBe(true);
  });

  it('flags invalid action config without throwing', () => {
    const res = dryRunRule({ condition: {}, actionType: 'notify', actionConfig: {} }, {});
    expect(res.status).toBe('invalid_config');
    expect(res.error).toMatch(/user/i);
  });
});
