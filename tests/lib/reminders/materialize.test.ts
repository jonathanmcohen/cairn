import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { materializeReminders } from '@/lib/reminders/materialize';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE reminders, db_cells, db_rows, db_properties, db_views, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function seed(opts: { dateValue: string | null; leadTimeMs: number }) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `u-${Date.now()}-${Math.random()}@x.test`, name: 'U', passwordHash: 'h' })
    .returning();
  if (!user) throw new Error('no user');
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'W', slug: `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
    .returning();
  if (!ws) throw new Error('no workspace');
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId: ws.id, title: 'P', createdBy: user.id })
    .returning();
  if (!page) throw new Error('no page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId: ws.id, pageId: page.id, name: 'Tasks', createdBy: user.id })
    .returning();
  if (!database) throw new Error('no database');
  const [dateProp] = await db
    .insert(schema.dbProperties)
    .values({
      databaseId: database.id,
      name: 'Due',
      type: 'date',
      config: { reminder: { leadTime: opts.leadTimeMs } },
      position: 0,
    })
    .returning();
  if (!dateProp) throw new Error('no prop');
  const [row] = await db
    .insert(schema.dbRows)
    .values({ databaseId: database.id, createdBy: user.id })
    .returning();
  if (!row) throw new Error('no row');
  if (opts.dateValue !== null) {
    await db.insert(schema.dbCells).values({
      rowId: row.id,
      propertyId: dateProp.id,
      value: opts.dateValue,
    });
  }
  return {
    workspaceId: ws.id,
    databaseId: database.id,
    datePropertyId: dateProp.id,
    rowId: row.id,
    assigneeId: user.id,
  };
}

describe('materializeReminders', () => {
  it('creates a reminder at dateValue minus leadTime', async () => {
    const f = await seed({
      dateValue: '2026-06-10T09:00:00.000Z',
      leadTimeMs: 24 * 60 * 60 * 1000,
    });
    await materializeReminders(db, {
      workspaceId: f.workspaceId,
      databaseId: f.databaseId,
      rowId: f.rowId,
    });
    const [r] = await db.select().from(schema.reminders).where(eq(schema.reminders.rowId, f.rowId));
    expect(r).toBeTruthy();
    expect(r?.remindAt.toISOString()).toBe('2026-06-09T09:00:00.000Z');
    expect(r?.firedAt).toBeNull();
    expect(r?.userId).toBe(f.assigneeId);
  });

  it('is idempotent — re-running updates remind_at in place, not duplicates', async () => {
    const f = await seed({ dateValue: '2026-06-10T09:00:00.000Z', leadTimeMs: 0 });
    await materializeReminders(db, {
      workspaceId: f.workspaceId,
      databaseId: f.databaseId,
      rowId: f.rowId,
    });
    await db
      .update(schema.dbCells)
      .set({ value: '2026-07-01T09:00:00.000Z' })
      .where(
        and(eq(schema.dbCells.rowId, f.rowId), eq(schema.dbCells.propertyId, f.datePropertyId)),
      );
    await materializeReminders(db, {
      workspaceId: f.workspaceId,
      databaseId: f.databaseId,
      rowId: f.rowId,
    });
    const all = await db.select().from(schema.reminders).where(eq(schema.reminders.rowId, f.rowId));
    expect(all).toHaveLength(1);
    expect(all[0]?.remindAt.toISOString()).toBe('2026-07-01T09:00:00.000Z');
  });

  it('removes the reminder when the date cell is cleared', async () => {
    const f = await seed({ dateValue: '2026-06-10T09:00:00.000Z', leadTimeMs: 0 });
    await materializeReminders(db, {
      workspaceId: f.workspaceId,
      databaseId: f.databaseId,
      rowId: f.rowId,
    });
    await db
      .update(schema.dbCells)
      .set({ value: null })
      .where(
        and(eq(schema.dbCells.rowId, f.rowId), eq(schema.dbCells.propertyId, f.datePropertyId)),
      );
    await materializeReminders(db, {
      workspaceId: f.workspaceId,
      databaseId: f.databaseId,
      rowId: f.rowId,
    });
    expect(
      await db.select().from(schema.reminders).where(eq(schema.reminders.rowId, f.rowId)),
    ).toHaveLength(0);
  });
});
