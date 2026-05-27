/**
 * v0.9.0 G2 P13 — Per-workspace cron registration helpers.
 *
 * The v0.7 P14 scheduler polls `cron_schedules` and spawns the CLI shim for
 * every due row; each workspace owns its own trash-purge schedule row so an
 * operator can disable / retime per tenant from the admin console. Helpers
 * here are the source of truth for the (workspace_id + command-prefix) match
 * key — call them at workspace-creation time and whenever a setting flips
 * that should reset the schedule.
 */
import { CronExpressionParser } from 'cron-parser';
import { and, eq, isNull, like } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/** Daily at 03:00 UTC. Per-workspace TZ-aware scheduling is out of scope for P13. */
const TRASH_PURGE_CRON = '0 3 * * *';

function trashPurgeCommand(workspaceId: string): string {
  return `trash:purge --workspace-id=${workspaceId}`;
}

function trashPurgeCommandLike(workspaceId: string): string {
  // The `cron_schedules` table doesn't carry a `kind` column, so we identify
  // the trash-purge row by its command prefix. The full workspace id makes
  // the prefix unique-per-workspace by construction.
  return `trash:purge --workspace-id=${workspaceId}%`;
}

/**
 * Registers (or updates) the per-workspace `trash:purge` cron row. Idempotent:
 * a second call updates the existing row instead of inserting a duplicate, and
 * re-enables it if an operator had toggled it off.
 */
export async function registerTrashPurgeCron(
  db: PostgresJsDatabase<typeof schema>,
  input: { workspaceId: string },
): Promise<void> {
  const command = trashPurgeCommand(input.workspaceId);
  const nextRunAt = CronExpressionParser.parse(TRASH_PURGE_CRON, {
    currentDate: new Date(),
    tz: 'UTC',
  })
    .next()
    .toDate();

  const existing = await db
    .select({ id: schema.cronSchedules.id })
    .from(schema.cronSchedules)
    .where(
      and(
        eq(schema.cronSchedules.workspaceId, input.workspaceId),
        like(schema.cronSchedules.command, trashPurgeCommandLike(input.workspaceId)),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.cronSchedules)
      .set({ command, cronSpec: TRASH_PURGE_CRON, enabled: true, nextRunAt })
      .where(eq(schema.cronSchedules.id, existing[0].id));
    return;
  }

  await db.insert(schema.cronSchedules).values({
    workspaceId: input.workspaceId,
    command,
    cronSpec: TRASH_PURGE_CRON,
    enabled: true,
    nextRunAt,
  });
}

/**
 * v0.9.0 G2 P14 — global `pages:auto-unlock` cron, every 5 minutes.
 *
 * Single row across the deployment (`workspace_id IS NULL`); the sweep
 * itself is workspace-scoped at the audit-row level. Identified by an exact
 * command match because the `cron_schedules` table doesn't carry a `kind`
 * column. Idempotent — re-running this updates the existing row instead of
 * inserting a duplicate and re-enables it if an operator toggled it off.
 */
const PAGE_AUTO_UNLOCK_CRON = '*/5 * * * *';
const PAGE_AUTO_UNLOCK_COMMAND = 'pages:auto-unlock';

export async function registerPageAutoUnlockCron(
  db: PostgresJsDatabase<typeof schema>,
): Promise<void> {
  const nextRunAt = CronExpressionParser.parse(PAGE_AUTO_UNLOCK_CRON, {
    currentDate: new Date(),
    tz: 'UTC',
  })
    .next()
    .toDate();

  const existing = await db
    .select({ id: schema.cronSchedules.id })
    .from(schema.cronSchedules)
    .where(
      and(
        isNull(schema.cronSchedules.workspaceId),
        eq(schema.cronSchedules.command, PAGE_AUTO_UNLOCK_COMMAND),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.cronSchedules)
      .set({
        command: PAGE_AUTO_UNLOCK_COMMAND,
        cronSpec: PAGE_AUTO_UNLOCK_CRON,
        enabled: true,
        nextRunAt,
      })
      .where(eq(schema.cronSchedules.id, existing[0].id));
    return;
  }

  await db.insert(schema.cronSchedules).values({
    workspaceId: null,
    command: PAGE_AUTO_UNLOCK_COMMAND,
    cronSpec: PAGE_AUTO_UNLOCK_CRON,
    enabled: true,
    nextRunAt,
  });
}

/**
 * v0.9.0 G3 P19 — global `flashcards:notify-due` cron, daily at 09:00 UTC.
 *
 * One row across the deployment (`workspace_id IS NULL`); the sweep itself
 * inserts one `flashcards_due` notification per (user, workspace) and is
 * idempotent within a UTC day. Identified by an exact command match (no
 * `kind` column on `cron_schedules`). Idempotent on re-register.
 */
const FLASHCARDS_NOTIFY_DUE_CRON = '0 9 * * *';
const FLASHCARDS_NOTIFY_DUE_COMMAND = 'flashcards:notify-due';

export async function registerFlashcardsNotifyDueCron(
  db: PostgresJsDatabase<typeof schema>,
): Promise<void> {
  const nextRunAt = CronExpressionParser.parse(FLASHCARDS_NOTIFY_DUE_CRON, {
    currentDate: new Date(),
    tz: 'UTC',
  })
    .next()
    .toDate();

  const existing = await db
    .select({ id: schema.cronSchedules.id })
    .from(schema.cronSchedules)
    .where(
      and(
        isNull(schema.cronSchedules.workspaceId),
        eq(schema.cronSchedules.command, FLASHCARDS_NOTIFY_DUE_COMMAND),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.cronSchedules)
      .set({
        command: FLASHCARDS_NOTIFY_DUE_COMMAND,
        cronSpec: FLASHCARDS_NOTIFY_DUE_CRON,
        enabled: true,
        nextRunAt,
      })
      .where(eq(schema.cronSchedules.id, existing[0].id));
    return;
  }

  await db.insert(schema.cronSchedules).values({
    workspaceId: null,
    command: FLASHCARDS_NOTIFY_DUE_COMMAND,
    cronSpec: FLASHCARDS_NOTIFY_DUE_CRON,
    enabled: true,
    nextRunAt,
  });
}

/**
 * v0.9.0 G8 P39 — global `siem:retry-sweep` cron, every minute.
 *
 * Single row (`workspace_id IS NULL`); the sweep is workspace-scoped at the
 * delivery-log level. Identified by an exact command match. Idempotent on
 * re-register — re-running updates the existing row and re-enables it if an
 * operator toggled it off.
 */
const SIEM_RETRY_SWEEP_CRON = '* * * * *';
const SIEM_RETRY_SWEEP_COMMAND = 'siem:retry-sweep';

export async function registerSiemRetrySweepCron(
  db: PostgresJsDatabase<typeof schema>,
): Promise<void> {
  const nextRunAt = CronExpressionParser.parse(SIEM_RETRY_SWEEP_CRON, {
    currentDate: new Date(),
    tz: 'UTC',
  })
    .next()
    .toDate();

  const existing = await db
    .select({ id: schema.cronSchedules.id })
    .from(schema.cronSchedules)
    .where(
      and(
        isNull(schema.cronSchedules.workspaceId),
        eq(schema.cronSchedules.command, SIEM_RETRY_SWEEP_COMMAND),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.cronSchedules)
      .set({
        command: SIEM_RETRY_SWEEP_COMMAND,
        cronSpec: SIEM_RETRY_SWEEP_CRON,
        enabled: true,
        nextRunAt,
      })
      .where(eq(schema.cronSchedules.id, existing[0].id));
    return;
  }

  await db.insert(schema.cronSchedules).values({
    workspaceId: null,
    command: SIEM_RETRY_SWEEP_COMMAND,
    cronSpec: SIEM_RETRY_SWEEP_CRON,
    enabled: true,
    nextRunAt,
  });
}

/**
 * v0.9.0 G8 P40 — global `siem:daily-archive` cron, daily at 01:15 UTC.
 *
 * Single row (`workspace_id IS NULL`); the sweep iterates every enabled
 * `kind='s3'` forwarder across the deployment. Identified by an exact command
 * match. Idempotent on re-register — re-running updates the existing row and
 * re-enables it if an operator toggled it off.
 */
const SIEM_DAILY_ARCHIVE_CRON = '15 1 * * *';
const SIEM_DAILY_ARCHIVE_COMMAND = 'siem:daily-archive';

export async function registerSiemDailyArchiveCron(
  db: PostgresJsDatabase<typeof schema>,
): Promise<void> {
  const nextRunAt = CronExpressionParser.parse(SIEM_DAILY_ARCHIVE_CRON, {
    currentDate: new Date(),
    tz: 'UTC',
  })
    .next()
    .toDate();

  const existing = await db
    .select({ id: schema.cronSchedules.id })
    .from(schema.cronSchedules)
    .where(
      and(
        isNull(schema.cronSchedules.workspaceId),
        eq(schema.cronSchedules.command, SIEM_DAILY_ARCHIVE_COMMAND),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.cronSchedules)
      .set({
        command: SIEM_DAILY_ARCHIVE_COMMAND,
        cronSpec: SIEM_DAILY_ARCHIVE_CRON,
        enabled: true,
        nextRunAt,
      })
      .where(eq(schema.cronSchedules.id, existing[0].id));
    return;
  }

  await db.insert(schema.cronSchedules).values({
    workspaceId: null,
    command: SIEM_DAILY_ARCHIVE_COMMAND,
    cronSpec: SIEM_DAILY_ARCHIVE_CRON,
    enabled: true,
    nextRunAt,
  });
}
