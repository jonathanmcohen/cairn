import type { AutomationOperator } from '@/db/schema';
import { evaluateCondition } from '@/lib/automation/condition';

/** Max nesting depth for a condition tree. Builder + dispatcher enforce this. */
export const MAX_CONDITION_TREE_DEPTH = 5;

/** A single leaf condition. `field` is a dotted path; `op`/`value` mirror the singular condition. */
export type ConditionNode = {
  field: string;
  op: AutomationOperator;
  value: unknown;
};

/** A logic group joining children with AND/OR. Children may themselves be groups. */
export type GroupNode = {
  logic: 'and' | 'or';
  children: Array<ConditionNode | GroupNode>;
};

/** The root is always a group. */
export type ConditionTree = GroupNode;

function isGroup(n: ConditionNode | GroupNode): n is GroupNode {
  return 'logic' in n && Array.isArray((n as GroupNode).children);
}

/**
 * Recursively evaluate a condition tree against the trigger payload.
 * - An empty group (no children) matches everything (parity with the singular `{}` condition).
 * - A leaf reuses `evaluateCondition`, so single-leaf semantics are unchanged from v0.7.
 * - Throws if nesting exceeds MAX_CONDITION_TREE_DEPTH (caught by the dispatcher → run marked failed).
 */
export function evaluateConditionTree(tree: ConditionTree, payload: unknown, depth = 0): boolean {
  if (depth > MAX_CONDITION_TREE_DEPTH) {
    throw new Error(`condition tree exceeds max depth ${MAX_CONDITION_TREE_DEPTH}`);
  }
  const { logic, children } = tree;
  if (children.length === 0) return true;

  const results = children.map((child) =>
    isGroup(child)
      ? evaluateConditionTree(child, payload, depth + 1)
      : evaluateCondition(
          { property: child.field, operator: child.op, value: child.value },
          payload,
        ),
  );

  return logic === 'and' ? results.every(Boolean) : results.some(Boolean);
}
