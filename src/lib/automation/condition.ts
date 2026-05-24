import type { AutomationCondition, AutomationOperator } from '@/db/schema';

/**
 * Resolve a dotted-path property like `row.cells.status` against the trigger payload.
 * Returns `undefined` if any segment is missing — callers treat that as "absent".
 */
function getByPath(payload: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, payload);
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v.length === 0) return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

/**
 * Evaluate one rule's condition against the trigger payload.
 * Empty condition (`{}`) matches everything — used by rules with no filter.
 * Unknown operators or unresolvable property paths return `false` (defensive).
 */
export function evaluateCondition(condition: AutomationCondition, payload: unknown): boolean {
  if (!('operator' in condition)) return true; // match-all
  const actual = getByPath(payload, condition.property);
  const expected = condition.value;
  const op: AutomationOperator = condition.operator;

  switch (op) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    case 'contains':
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
      );
    case 'not_contains':
      return (
        typeof actual === 'string' && typeof expected === 'string' && !actual.includes(expected)
      );
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'between': {
      if (typeof actual !== 'number') return false;
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const [lo, hi] = expected as [unknown, unknown];
      if (typeof lo !== 'number' || typeof hi !== 'number') return false;
      return actual >= lo && actual <= hi;
    }
    case 'is_empty':
      return isEmpty(actual);
    case 'is_not_empty':
      return !isEmpty(actual);
    case 'is_true':
      return actual === true;
    case 'is_false':
      return actual === false;
    default:
      return false;
  }
}
