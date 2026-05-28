/**
 * v0.9.0 G2 P14 — Page auto-unlock sweep.
 *
 * Clears every `pages` row whose `locked_until` has passed, in a single
 * transaction that emits one `page.auto_unlocked` audit row per affected page.
 * Pages with `locked_until IS NULL` (manual-unlock-only) and pages whose
 * `locked_until` is still in the future are left untouched.
 *
 * Called from the scheduler via `cli pages:auto-unlock` (single global cron
 * row, every 5 minutes) and exposed as a pure function so tests can drive it
 * directly without spawning a child process.
 *
 * Idempotent: a second sweep with no expired rows is a clean no-op. The
 * pre-update SELECT + post-update audit-row fan-out runs inside a single
 * transaction so the audit log never drifts from `pages` state — a crash
 * between the two would roll the UPDATE back.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

export type AutoUnlockResult = {
  unlockedCount: number;
};

export async function runAutoUnlockSweep(
  db: PostgresJsDatabase<typeof schema>,
): Promise<AutoUnlockResult> {
  return db.transaction(async (tx) => {
    // Lock the rows we're about to clear so a concurrent unlock can't double-audit.
    const expired = (await tx.execute(sql`
      SELECT id AS page_id, workspace_id, locked_by, locked_at, locked_until
        FROM pages
       WHERE locked_at IS NOT NULL
         AND locked_until IS NOT NULL
         AND locked_until < now()
       FOR UPDATE
    `)) as unknown as Array<{
      page_id: string;
      workspace_id: string;
      locked_by: string | null;
      locked_at: Date | string;
      locked_until: Date | string;
    }>;

    if (expired.length === 0) {
      return { unlockedCount: 0 };
    }

    await tx.execute(sql`
      UPDATE pages
         SET locked_at = NULL,
             locked_by = NULL,
             locked_until = NULL
       WHERE locked_at IS NOT NULL
         AND locked_until IS NOT NULL
         AND locked_until < now()
    `);

    for (const row of expired) {
      // `db.execute()` returns timestamp columns as ISO strings rather than
      // Date instances — normalize so the audit metadata format is stable
      // regardless of the driver's row-shape.
      const lockedAtIso =
        row.locked_at instanceof Date ? row.locked_at.toISOString() : String(row.locked_at);
      const lockedUntilIso =
        row.locked_until instanceof Date
          ? row.locked_until.toISOString()
          : String(row.locked_until);
      await recordAudit(tx, {
        workspaceId: row.workspace_id,
        // `actor` is null because the sweep is an automated system action; the
        // originalLockerId is preserved in metadata for operators.
        actorUserId: null,
        action: 'page.auto_unlocked',
        targetType: 'page',
        targetId: row.page_id,
        metadata: {
          pageId: row.page_id,
          originalLockerId: row.locked_by,
          lockedAt: lockedAtIso,
          lockedUntil: lockedUntilIso,
        },
      });
    }

    return { unlockedCount: expired.length };
  });
}
