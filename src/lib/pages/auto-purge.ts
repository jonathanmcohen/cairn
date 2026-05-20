import type * as schema from '@/db/schema';
import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

const ADVISORY_LOCK_KEY = 712491;
const THROTTLE_SECONDS = 60 * 60; // 1 hour

export type AutoPurgeInput = {
  retentionDays: number;
};

/**
 * Opportunistic, throttled purge of soft-deleted pages older than retentionDays.
 *
 * - Uses pg_try_advisory_xact_lock so only one process at a time runs the query.
 * - Reads system_meta.last_purge_at; if updated within the last hour, returns 0.
 * - On success: deletes expired rows (FK cascade removes descendants), updates last_purge_at.
 *
 * Returns the number of rows deleted (0 if throttled, skipped, or nothing to purge).
 */
export async function autoPurge(
  db: PostgresJsDatabase<typeof schema>,
  input: AutoPurgeInput,
): Promise<number> {
  return db.transaction(async (tx) => {
    const lockRows = (await tx.execute(rawSql`
      SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS acquired
    `)) as unknown as { acquired: boolean }[];
    if (!lockRows[0]?.acquired) return 0;

    const meta = (await tx.execute(rawSql`
      SELECT value FROM system_meta WHERE key = 'last_purge_at' LIMIT 1
    `)) as unknown as { value: string }[];

    if (meta[0]?.value) {
      const last = new Date(meta[0].value);
      if (!Number.isNaN(last.getTime())) {
        const ageSec = (Date.now() - last.getTime()) / 1000;
        if (ageSec < THROTTLE_SECONDS) return 0;
      }
    }

    const result = (await tx.execute(rawSql`
      WITH purged AS (
        DELETE FROM pages
        WHERE deleted_at IS NOT NULL
          AND deleted_root = true
          AND deleted_at < now() - (${input.retentionDays} * interval '1 day')
        RETURNING id
      )
      SELECT count(*)::int AS count FROM purged
    `)) as unknown as { count: number }[];

    await tx.execute(rawSql`
      INSERT INTO system_meta (key, value)
      VALUES ('last_purge_at', now()::text)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
    `);

    return Number(result[0]?.count ?? 0);
  });
}
