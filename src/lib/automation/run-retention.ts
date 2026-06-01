import { sql as rawSql } from 'drizzle-orm';
import type { getDb } from '@/db/client';

/** Default per-rule cap on stored run-history rows. */
export const RUN_HISTORY_CAP = 100;

/**
 * Delete all but the `cap` most-recent automation_runs for one rule. Keyed by the
 * (rule_id, created_at) index. Called by the dispatcher after each run insert so
 * history never grows unbounded; safe to call when already under the cap.
 */
export async function pruneRunHistory(
  db: ReturnType<typeof getDb>,
  ruleId: string,
  cap: number = RUN_HISTORY_CAP,
): Promise<void> {
  await db.execute(rawSql`
    DELETE FROM automation_runs
    WHERE rule_id = ${ruleId}::uuid
      AND id NOT IN (
        SELECT id FROM automation_runs
        WHERE rule_id = ${ruleId}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT ${cap}
      )
  `);
}
