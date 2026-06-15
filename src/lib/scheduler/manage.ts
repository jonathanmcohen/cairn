/**
 * v0.10.3 CFG-3 — admin Schedules management helpers.
 *
 * Pure, db-injected operations over the `cron_schedules` table that back the
 * Settings → Admin → Schedules console: list every row, edit the cron
 * expression / enabled flag (recomputing next_run when the cron changes), and
 * "run now" (set next_run_at = now() so the in-process poller picks it up on
 * its next tick — we never spawn the CLI from the request path, which keeps
 * the single-runner advisory-lock semantics intact).
 *
 * The actual execution lives in src/server/scheduler.ts; these helpers only
 * touch the schedule rows.
 */
import { CronExpressionParser } from 'cron-parser';
import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Operator-facing view of a `cron_schedules` row (no internal-only columns). */
export type ScheduleRow = {
  id: string;
  workspaceId: string | null;
  command: string;
  cronSpec: string;
  nextRunAt: string; // ISO
  lastRunAt: string | null; // ISO
  lastStatus: string | null;
  lastError: string | null;
  enabled: boolean;
};

/** Thrown when a supplied cron expression cannot be parsed — surfaced as 400. */
export class InvalidCronError extends Error {
  constructor(spec: string, cause: unknown) {
    super(`invalid cron expression "${spec}": ${cause instanceof Error ? cause.message : cause}`);
    this.name = 'InvalidCronError';
  }
}

function toRow(r: schema.CronSchedule): ScheduleRow {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    command: r.command,
    cronSpec: r.cronSpec,
    nextRunAt: r.nextRunAt.toISOString(),
    lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
    lastStatus: r.lastStatus,
    lastError: r.lastError,
    enabled: r.enabled,
  };
}

/**
 * Validate a cron expression and compute the next fire instant from `now`.
 * Throws {@link InvalidCronError} on a malformed spec (callers map to 400).
 * UTC-anchored to match cron-register.ts.
 */
export function nextRunFromCron(cronSpec: string, now: Date = new Date()): Date {
  try {
    return CronExpressionParser.parse(cronSpec, { currentDate: now, tz: 'UTC' }).next().toDate();
  } catch (err) {
    throw new InvalidCronError(cronSpec, err);
  }
}

/** All cron_schedules rows (global + per-workspace), ordered by command then id. */
export async function listSchedules(db: Db): Promise<ScheduleRow[]> {
  const rows = await db
    .select()
    .from(schema.cronSchedules)
    .orderBy(asc(schema.cronSchedules.command), asc(schema.cronSchedules.id));
  return rows.map(toRow);
}

export type UpdateScheduleInput = {
  cronSpec?: string;
  enabled?: boolean;
};

/**
 * Edit a schedule's cron expression and/or enabled flag. When `cronSpec`
 * changes, `next_run_at` is recomputed from the new expression. Invalid cron
 * throws {@link InvalidCronError} (→ 400) before any write. Idempotent: a
 * no-field call returns the current row unchanged. Returns null when the id
 * doesn't exist.
 */
export async function updateSchedule(
  db: Db,
  id: string,
  input: UpdateScheduleInput,
): Promise<ScheduleRow | null> {
  const set: Partial<schema.NewCronSchedule> = {};
  if (input.cronSpec !== undefined) {
    // Validate + compute the next fire BEFORE writing so a bad spec is a clean
    // 400 with no partial mutation.
    set.cronSpec = input.cronSpec;
    set.nextRunAt = nextRunFromCron(input.cronSpec);
  }
  if (input.enabled !== undefined) {
    set.enabled = input.enabled;
  }

  if (Object.keys(set).length === 0) {
    const [row] = await db
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.id, id))
      .limit(1);
    return row ? toRow(row) : null;
  }

  const [row] = await db
    .update(schema.cronSchedules)
    .set(set)
    .where(eq(schema.cronSchedules.id, id))
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Mark a schedule due immediately by setting next_run_at = now(). The
 * in-process poller (≤60s cadence) then runs it under the single-runner
 * advisory lock — we deliberately do NOT spawn the CLI from the request path,
 * so "run now" means "due immediately", not "executed synchronously". Returns
 * null when the id doesn't exist.
 */
export async function runScheduleNow(db: Db, id: string): Promise<ScheduleRow | null> {
  const [row] = await db
    .update(schema.cronSchedules)
    .set({ nextRunAt: new Date() })
    .where(eq(schema.cronSchedules.id, id))
    .returning();
  return row ? toRow(row) : null;
}
