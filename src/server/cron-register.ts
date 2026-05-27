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
import { and, eq, like } from 'drizzle-orm';
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
