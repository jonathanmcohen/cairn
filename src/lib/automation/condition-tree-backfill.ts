import type { AutomationCondition } from '@/db/schema';
import type { ConditionTree } from '@/lib/automation/condition-tree';

/**
 * Wrap an existing singular automation condition as one implicit AND group.
 * Mirrors the SQL backfill in migration 0058 so the dispatcher can compute the
 * same fallback at runtime for rows whose condition_tree is still null.
 */
export function flatConditionToTree(condition: AutomationCondition): ConditionTree {
  if (!('operator' in condition)) return { logic: 'and', children: [] };
  return {
    logic: 'and',
    children: [{ field: condition.property, op: condition.operator, value: condition.value }],
  };
}
