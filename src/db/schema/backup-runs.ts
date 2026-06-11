import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * v0.10.0 C3 — durable backup-run history.
 *
 * One row per CLI `backup` invocation (manual create-now button, cron
 * scheduler tick, or an operator shelling in — they all funnel through the
 * same `node dist/server/cli.js backup` path, which writes here via
 * src/lib/backups/run-history.ts). Unlike the per-process job registry in
 * src/lib/backups/jobs.ts, these rows survive restarts and are visible from
 * every replica — the schedule admin UI reads the last 20 for its history
 * table.
 *
 * `status` is 'running' | 'done' | 'failed'; `trigger` is 'manual' |
 * 'scheduled' (both CHECK-constrained in migration 0071). `bundle_ts` is the
 * `cairn-backup-<ts>` stamp of the produced bundle (null while running or
 * when the dump failed before producing one).
 */
export const backupRuns = pgTable(
  'backup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull(), // 'running' | 'done' | 'failed'
    trigger: text('trigger').notNull(), // 'manual' | 'scheduled'
    bundleTs: text('bundle_ts'),
    error: text('error'),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    // Hot path: the schedule UI/API reads the newest N runs.
    index('backup_runs_started_at_idx').on(t.startedAt.desc()),
  ],
);

export type BackupRun = typeof backupRuns.$inferSelect;
export type NewBackupRun = typeof backupRuns.$inferInsert;
