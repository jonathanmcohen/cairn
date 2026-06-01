import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';

describe('automation schema additions', () => {
  it('automation_rules exposes a conditionTree column', () => {
    expect(schema.automationRules.conditionTree).toBeDefined();
  });

  it('automation_rule_actions table is exported with sortOrder', () => {
    expect(schema.automationRuleActions).toBeDefined();
    expect(schema.automationRuleActions.sortOrder).toBeDefined();
  });
});
