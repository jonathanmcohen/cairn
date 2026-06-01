import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { logger } from '@/lib/observability/logger';
import { runAction } from './actions';
import { evaluateCondition } from './condition';
import type { TriggerEvent } from './events';

// TRIGGER_EVENTS + TriggerEvent live in the dependency-free `./events` module so
// Client Components can import them without dragging this server-only dispatcher
// (DB client, action runners) into the browser bundle. Re-exported here for
// existing server-side consumers (API routes, this dispatcher).
export { TRIGGER_EVENTS, type TriggerEvent } from './events';

/**
 * Indirection holder — the dispatcher calls `actionRunner.runAction(...)` so
 * `vi.spyOn(actionRunner, 'runAction')` works in tests. P17 wired this through
 * to the real `runAction` registry under `src/lib/automation/actions`.
 */
export const actionRunner = { runAction };

/**
 * Load enabled rules for `workspaceId` matching `event`, evaluate each rule's
 * condition against `payload`, run the action, and write an `automation_runs`
 * row per evaluation. Never throws into the caller.
 *
 * Called from the webhook emit code path via setImmediate post-commit — same
 * pattern as v0.6 P11 email send + v0.5 webhook delivery.
 */
export async function evaluateRules(
  event: TriggerEvent | string,
  workspaceId: string,
  payload: unknown,
): Promise<void> {
  try {
    const db = getDb();
    const rules = await db
      .select()
      .from(schema.automationRules)
      .where(
        and(
          eq(schema.automationRules.workspaceId, workspaceId),
          eq(schema.automationRules.triggerEvent, event),
          eq(schema.automationRules.enabled, true),
        ),
      );
    if (rules.length === 0) return;

    for (const rule of rules) {
      const matched = evaluateCondition(rule.condition, payload);
      if (!matched) {
        await db.insert(schema.automationRuns).values({
          ruleId: rule.id,
          triggerPayload: (payload ?? {}) as Record<string, unknown>,
          status: 'condition_unmet',
        });
        continue;
      }
      try {
        await actionRunner.runAction(
          rule.actionType as schema.AutomationActionType,
          rule.actionConfig,
          payload,
          {
            ruleId: rule.id,
            workspaceId: rule.workspaceId,
            createdBy: rule.createdBy,
          },
        );
        await db.insert(schema.automationRuns).values({
          ruleId: rule.id,
          triggerPayload: (payload ?? {}) as Record<string, unknown>,
          status: 'success',
        });
      } catch (err) {
        await db.insert(schema.automationRuns).values({
          ruleId: rule.id,
          triggerPayload: (payload ?? {}) as Record<string, unknown>,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        logger.warn(
          {
            ruleId: rule.id,
            err: err instanceof Error ? { message: err.message, name: err.name } : err,
          },
          '[automation] action failed',
        );
      }
    }
  } catch (err) {
    // Never propagate into the originating mutation.
    logger.error(
      { err: err instanceof Error ? { message: err.message, name: err.name } : err },
      '[automation] evaluateRules failed',
    );
  }
}
