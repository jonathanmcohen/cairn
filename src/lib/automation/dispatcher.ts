import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { logger } from '@/lib/observability/logger';
import { evaluateCondition } from './condition';

/**
 * Closed enum of trigger events. Mirrors v0.5 `WebhookEvent` from
 * src/lib/webhooks/dispatch.ts so any event a webhook can subscribe to can
 * also fire an automation rule. Kept as a const tuple so the UI dropdown
 * (P18) can iterate it.
 */
export const TRIGGER_EVENTS = [
  'page.created',
  'page.updated',
  'page.deleted',
  'row.created',
  'row.updated',
  'row.deleted',
  'comment.created',
] as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/**
 * Stub runner — replaced by the real registry in P17. Exported only so the
 * P16 tests can vi.spyOn it. Default behavior is a no-op (success).
 *
 * Implementation is held on an exported object (`actionRunner`) so vitest's
 * `vi.spyOn(mod, 'runActionStub')` can intercept calls made via the module
 * export. The dispatcher invokes `actionRunner.runActionStub(...)` — both the
 * named export and the holder field point to the same function, and the spy
 * replaces both.
 */
export async function runActionStub(
  _actionType: schema.AutomationActionType,
  _actionConfig: Record<string, unknown>,
  _payload: unknown,
): Promise<void> {
  // Real implementation arrives in P17 (`src/lib/automation/actions/index.ts`).
}

/**
 * Indirection holder — the dispatcher calls `actionRunner.runActionStub(...)`
 * so `vi.spyOn(actionRunner, 'runActionStub')` works in tests.
 */
export const actionRunner = { runActionStub };

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
        await actionRunner.runActionStub(
          rule.actionType as schema.AutomationActionType,
          rule.actionConfig,
          payload,
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
