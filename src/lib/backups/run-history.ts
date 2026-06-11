import postgres from 'postgres';

/**
 * v0.10.0 C3 — durable backup-run history + single-flight advisory lock.
 *
 * The CLI's `backup` dispatch (src/server/cli.ts) wraps the whole
 * dump/push/prune sequence in runBackupWithHistory so every run — manual
 * create-now, cron scheduler tick, operator shell — leaves a `backup_runs`
 * row that survives process restarts (unlike the per-process job registry in
 * src/lib/backups/jobs.ts).
 *
 * Concurrency: pg_try_advisory_lock on a fixed key makes the dump
 * single-flight ACROSS PROCESSES sharing one database — the create-now button
 * racing a cron tick (or a second replica's scheduler double-firing) yields
 * exactly one real dump. The loser records a failed run with the
 * 'another backup is running' error and the CLI exits 0 (the work IS being
 * done, just by someone else — a non-zero exit would page operators about a
 * non-problem).
 *
 * Uses a dedicated single-connection postgres-js client (max: 1): advisory
 * locks are SESSION-scoped, so try-lock and unlock must run on the same
 * physical connection — a pooled client could acquire on one connection and
 * "release" on another.
 */

/**
 * Fixed advisory-lock key for "a Cairn backup is in flight". Arbitrary but
 * STABLE literal — never change it, or in-flight old-version backups and
 * new-version backups would stop excluding each other during an upgrade.
 */
export const BACKUP_ADVISORY_LOCK_KEY = 746_450_424_143;

/** Error text recorded on the run row when the advisory lock is contended. */
export const BACKUP_LOCK_HELD_ERROR = 'another backup is running';

export type BackupTrigger = 'manual' | 'scheduled';

export type BackupRunOutcome =
  | { kind: 'done'; runId: string; bundleTs: string }
  /** Advisory lock held by another process — no dump attempted, exit 0. */
  | { kind: 'locked'; runId: string };

export async function runBackupWithHistory(opts: {
  databaseUrl: string;
  trigger: BackupTrigger;
  /** The actual backup work (dump + optional push/prune). Returns the bundle `<ts>` stamp. */
  doBackup: () => Promise<string>;
}): Promise<BackupRunOutcome> {
  const sql = postgres(opts.databaseUrl, { max: 1 });
  try {
    const [lock] = await sql<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_lock(${BACKUP_ADVISORY_LOCK_KEY}) AS locked`;
    if (!lock?.locked) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO backup_runs (started_at, finished_at, status, trigger, error, duration_ms)
        VALUES (now(), now(), 'failed', ${opts.trigger}, ${BACKUP_LOCK_HELD_ERROR}, 0)
        RETURNING id`;
      if (!row) throw new Error('backup_runs insert returned no row');
      return { kind: 'locked', runId: row.id };
    }

    try {
      const startedMs = Date.now();
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO backup_runs (started_at, status, trigger)
        VALUES (now(), 'running', ${opts.trigger})
        RETURNING id`;
      if (!row) throw new Error('backup_runs insert returned no row');

      try {
        const bundleTs = await opts.doBackup();
        await sql`
          UPDATE backup_runs
          SET status = 'done', finished_at = now(),
              duration_ms = ${Date.now() - startedMs}, bundle_ts = ${bundleTs}
          WHERE id = ${row.id}`;
        return { kind: 'done', runId: row.id, bundleTs };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await sql`
          UPDATE backup_runs
          SET status = 'failed', finished_at = now(),
              duration_ms = ${Date.now() - startedMs}, error = ${message}
          WHERE id = ${row.id}`;
        throw err;
      }
    } finally {
      // Session-scoped: also auto-released if the process dies, so a crashed
      // backup can never wedge future runs.
      await sql`SELECT pg_advisory_unlock(${BACKUP_ADVISORY_LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
