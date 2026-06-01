/**
 * G16 #163 — updateCells materializes reminders on a date-cell write.
 *
 * A date property carrying `{ reminder: { leadTime } }` in its config jsonb
 * should produce exactly one reminders row at (date − leadTime) when the cell
 * is set, and remove it when the cell is cleared. Non-date / non-reminder
 * properties produce no reminder.
 */
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { updateCells } from '@/lib/databases/rows';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE reminders, db_cells, db_rows, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function seed() {
  const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
  const [page] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'DB page', createdBy: u.userId })
    .returning();
  if (!page) throw new Error('page insert failed');
  const [database] = await getDb()
    .insert(schema.databases)
    .values({ workspaceId: u.workspaceId, pageId: page.id, name: 'DB', createdBy: u.userId })
    .returning();
  if (!database) throw new Error('db insert failed');
  const [dateProp] = await getDb()
    .insert(schema.dbProperties)
    .values({
      databaseId: database.id,
      name: 'Due',
      type: 'date',
      config: { reminder: { leadTime: 3_600_000 } },
    })
    .returning();
  const [textProp] = await getDb()
    .insert(schema.dbProperties)
    .values({ databaseId: database.id, name: 'Note', type: 'text', config: {} })
    .returning();
  const [row] = await getDb()
    .insert(schema.dbRows)
    .values({ databaseId: database.id, createdBy: u.userId })
    .returning();
  if (!dateProp || !textProp || !row) throw new Error('seed insert failed');
  return {
    workspaceId: u.workspaceId,
    databaseId: database.id,
    rowId: row.id,
    datePropId: dateProp.id,
    textPropId: textProp.id,
  };
}

async function reminderRows(rowId: string, propertyId: string) {
  return getDb()
    .select()
    .from(schema.reminders)
    .where(and(eq(schema.reminders.rowId, rowId), eq(schema.reminders.propertyId, propertyId)));
}

describe('updateCells reminder materialization (G16 #163)', () => {
  it('creates a reminder at date − leadTime when a reminder-date cell is set', async () => {
    const s = await seed();
    await updateCells(getDb(), {
      rowId: s.rowId,
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      cells: { [s.datePropId]: '2030-01-01T00:00:00.000Z' },
    });

    const rows = await reminderRows(s.rowId, s.datePropId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.remindAt.toISOString()).toBe('2029-12-31T23:00:00.000Z');
  });

  it('removes the reminder when the date cell is cleared', async () => {
    const s = await seed();
    await updateCells(getDb(), {
      rowId: s.rowId,
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      cells: { [s.datePropId]: '2030-01-01T00:00:00.000Z' },
    });
    expect(await reminderRows(s.rowId, s.datePropId)).toHaveLength(1);

    await updateCells(getDb(), {
      rowId: s.rowId,
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      cells: { [s.datePropId]: '' },
    });
    expect(await reminderRows(s.rowId, s.datePropId)).toHaveLength(0);
  });

  it('does not create a reminder for a non-reminder text property', async () => {
    const s = await seed();
    await updateCells(getDb(), {
      rowId: s.rowId,
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      cells: { [s.textPropId]: 'hello' },
    });
    expect(await reminderRows(s.rowId, s.textPropId)).toHaveLength(0);
  });
});
