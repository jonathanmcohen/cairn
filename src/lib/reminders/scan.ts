import { and, eq, isNull, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Fire polled in-app notifications for every due, unfired reminder, then stamp
 * fired_at so each reminder fires at most once. Served by the partial index
 * `reminders(remind_at) WHERE fired_at IS NULL` (P21 migration 0022).
 *
 * SINGLE-INSTANCE CEILING: no distributed lock for v1.0 — two instances
 * scanning concurrently can double-fire (same ceiling as backup ticker and
 * single-instance collab). Run via external cron or the opt-in
 * `CAIRN_REMINDER_INTERVAL` ticker on exactly one instance.
 */
export async function scanReminders(db: Db, now: Date = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(schema.reminders)
    .where(and(lte(schema.reminders.remindAt, now), isNull(schema.reminders.firedAt)));
  if (due.length === 0) return 0;

  let fired = 0;
  for (const r of due) {
    await db.transaction(async (tx) => {
      await tx.insert(schema.notifications).values({
        userId: r.userId,
        workspaceId: r.workspaceId,
        type: 'reminder',
        payload: {
          reminderId: r.id,
          databaseId: r.databaseId,
          rowId: r.rowId,
          propertyId: r.propertyId,
          remindAt: r.remindAt.toISOString(),
        },
      });
      await tx.update(schema.reminders).set({ firedAt: now }).where(eq(schema.reminders.id, r.id));
    });
    fired += 1;
  }
  return fired;
}
