import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

type ReminderConfig = { leadTime: number };

/**
 * Materialize (create/update/remove) the reminders row(s) for a single db row,
 * driven by the per-database date-property reminder config in db_properties.config
 * jsonb (`{ reminder: { leadTime } }` — leadTime in ms). Idempotent per
 * (row_id, property_id): re-running on a date edit updates remind_at in place;
 * clearing the date deletes the reminder. No notification is fired here —
 * scanReminders (Task 4) does that.
 *
 * Target user = the row's createdBy (no `person` property type in this schema;
 * watcher fan-out is future work).
 */
export async function materializeReminders(
  db: Db,
  input: { workspaceId: string; databaseId: string; rowId: string },
): Promise<void> {
  // 1. Date properties that carry a reminder spec in their config jsonb.
  const props = await db
    .select()
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.databaseId, input.databaseId));

  const reminderProps = props
    .filter((p) => p.type === 'date')
    .map((p) => {
      const cfg = (p.config as { reminder?: ReminderConfig } | null)?.reminder;
      return cfg ? { propertyId: p.id, leadTime: cfg.leadTime } : null;
    })
    .filter((x): x is { propertyId: string; leadTime: number } => x !== null);

  if (reminderProps.length === 0) return;

  // 2. Resolve target (createdBy on the row).
  const [row] = await db
    .select({ createdBy: schema.dbRows.createdBy })
    .from(schema.dbRows)
    .where(eq(schema.dbRows.id, input.rowId));
  if (!row) return;

  for (const r of reminderProps) {
    const [cell] = await db
      .select()
      .from(schema.dbCells)
      .where(
        and(eq(schema.dbCells.rowId, input.rowId), eq(schema.dbCells.propertyId, r.propertyId)),
      );

    const raw = cell?.value as string | null | undefined;

    // No date → ensure no stale reminder remains.
    if (raw === null || raw === undefined || raw === '') {
      await db
        .delete(schema.reminders)
        .where(
          and(
            eq(schema.reminders.rowId, input.rowId),
            eq(schema.reminders.propertyId, r.propertyId),
          ),
        );
      continue;
    }

    const remindAt = new Date(new Date(raw).getTime() - r.leadTime);

    // Upsert keyed on (row_id, property_id): delete-then-insert keeps it simple
    // and correct without assuming a unique index across schema variants.
    await db
      .delete(schema.reminders)
      .where(
        and(eq(schema.reminders.rowId, input.rowId), eq(schema.reminders.propertyId, r.propertyId)),
      );
    await db.insert(schema.reminders).values({
      workspaceId: input.workspaceId,
      databaseId: input.databaseId,
      propertyId: r.propertyId,
      rowId: input.rowId,
      userId: row.createdBy,
      remindAt,
    });
  }
}
