import { CronExpressionParser } from 'cron-parser';
import { and, desc, eq, isNull, like } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * v0.10.0 C3 — THE scheduled-backup row in `cron_schedules`.
 *
 * Exactly one global backup schedule is supported (workspace_id IS NULL,
 * command prefix 'backup ' — the table has no `kind` column, same convention
 * as src/server/cron-register.ts). The command string is built SERVER-SIDE
 * here: the v0.7 audit's trap was an operator-authored schedule row without
 * `--out`, which makes the CLI throw on every tick — so the API never accepts
 * a raw command, only structured fields, and `--out` is always present.
 */

/** Command-prefix match key for the backup schedule row (no `kind` column). */
const BACKUP_COMMAND_LIKE = 'backup %';

export type BackupScheduleSettings = {
  /** Sweep target: 'local' keeps bundles on disk only, 's3' also pushes to FileStorage. */
  target: 'local' | 's3';
  /** Age-based pruning (`--retention-days`). */
  retentionDays?: number;
  /** Keep-newest-N pruning (`--keep`), applied after retention-days. */
  keep?: number;
};

/**
 * True when the spec parses with the SAME parser the scheduler advances
 * next_run_at with (cron-parser) — anything accepted here is guaranteed to be
 * runnable by src/server/scheduler.ts and can never poison-loop the row.
 */
export function isValidCronSpec(spec: string): boolean {
  // cron-parser silently substitutes its default expression for a blank
  // input — a blank spec must be rejected, not become "every second".
  if (spec.trim() === '') return false;
  try {
    CronExpressionParser.parse(spec, { currentDate: new Date(), tz: 'UTC' });
    return true;
  } catch {
    return false;
  }
}

/** Next fire time for a (pre-validated) spec — mirrors cron-register.ts. */
export function nextRunAtFromCronSpec(spec: string): Date {
  return CronExpressionParser.parse(spec, { currentDate: new Date(), tz: 'UTC' }).next().toDate();
}

/**
 * Build the CLI command string stored on the cron row. ALWAYS contains
 * `--out` (the audit trap: a backup row without --out throws at run time)
 * and `--trigger scheduled` (so the run-history row records its origin).
 */
export function buildBackupCommand(opts: { outDir: string } & BackupScheduleSettings): string {
  // scheduler.ts splits the stored command on whitespace with no quoting
  // support — an outDir containing whitespace would shear into bogus argv.
  if (/\s/.test(opts.outDir) || opts.outDir.length === 0) {
    throw new Error(
      `CAIRN_BACKUP_DIR must be a non-empty path without whitespace: "${opts.outDir}"`,
    );
  }
  let command = `backup --out ${opts.outDir} --trigger scheduled`;
  if (opts.retentionDays !== undefined) command += ` --retention-days ${opts.retentionDays}`;
  if (opts.keep !== undefined) command += ` --keep ${opts.keep}`;
  if (opts.target === 's3') command += ' --target s3';
  return command;
}

/** Inverse of buildBackupCommand — initial values for the settings form. */
export function parseBackupCommand(command: string): BackupScheduleSettings {
  const retention = command.match(/--retention-days (\d+)/);
  const keep = command.match(/--keep (\d+)/);
  return {
    target: /--target s3\b/.test(command) ? 's3' : 'local',
    retentionDays: retention?.[1] ? Number(retention[1]) : undefined,
    keep: keep?.[1] ? Number(keep[1]) : undefined,
  };
}

export async function getBackupSchedule(db: Db): Promise<schema.CronSchedule | null> {
  const rows = await db
    .select()
    .from(schema.cronSchedules)
    .where(
      and(
        isNull(schema.cronSchedules.workspaceId),
        like(schema.cronSchedules.command, BACKUP_COMMAND_LIKE),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert THE single backup schedule row. Unlike the register* helpers in
 * cron-register.ts this does NOT force-enable: the admin's toggle is the
 * source of truth, so `enabled` is written verbatim.
 */
export async function upsertBackupSchedule(
  db: Db,
  input: { outDir: string; enabled: boolean; cronSpec: string } & BackupScheduleSettings,
): Promise<schema.CronSchedule> {
  const command = buildBackupCommand(input);
  const nextRunAt = nextRunAtFromCronSpec(input.cronSpec);

  const existing = await getBackupSchedule(db);
  if (existing) {
    const updated = await db
      .update(schema.cronSchedules)
      .set({ command, cronSpec: input.cronSpec, enabled: input.enabled, nextRunAt })
      .where(eq(schema.cronSchedules.id, existing.id))
      .returning();
    const row = updated[0];
    if (!row) throw new Error('backup schedule update returned no row');
    return row;
  }

  const inserted = await db
    .insert(schema.cronSchedules)
    .values({
      workspaceId: null,
      command,
      cronSpec: input.cronSpec,
      enabled: input.enabled,
      nextRunAt,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('backup schedule insert returned no row');
  return row;
}

/** Remove the backup schedule row. Returns true when a row was deleted. */
export async function deleteBackupSchedule(db: Db): Promise<boolean> {
  const existing = await getBackupSchedule(db);
  if (!existing) return false;
  await db.delete(schema.cronSchedules).where(eq(schema.cronSchedules.id, existing.id));
  return true;
}

/** Newest-first slice of the durable run history (default: last 20). */
export async function listRecentBackupRuns(db: Db, limit = 20): Promise<schema.BackupRun[]> {
  return db
    .select()
    .from(schema.backupRuns)
    .orderBy(desc(schema.backupRuns.startedAt))
    .limit(limit);
}
