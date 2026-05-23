import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { scanReminders } from '@/lib/reminders/scan';
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
  await sql`TRUNCATE notifications, reminders, db_cells, db_rows, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function seedDue(opts: { remindAt: Date }) {
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
    .values({ workspaceId: ws.id, title: 'p', createdBy: user.id })
    .returning();
  if (!page) throw new Error('no page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId: ws.id, pageId: page.id, name: 'Tasks', createdBy: user.id })
    .returning();
  if (!database) throw new Error('no database');
  const [prop] = await db
    .insert(schema.dbProperties)
    .values({ databaseId: database.id, name: 'Due', type: 'date', config: {}, position: 0 })
    .returning();
  if (!prop) throw new Error('no prop');
  const [row] = await db
    .insert(schema.dbRows)
    .values({ databaseId: database.id, createdBy: user.id })
    .returning();
  if (!row) throw new Error('no row');
  const [r] = await db
    .insert(schema.reminders)
    .values({
      workspaceId: ws.id,
      databaseId: database.id,
      propertyId: prop.id,
      rowId: row.id,
      userId: user.id,
      remindAt: opts.remindAt,
    })
    .returning();
  if (!r) throw new Error('no reminder');
  return { workspaceId: ws.id, userId: user.id, reminderId: r.id };
}

describe('scanReminders', () => {
  it('fires a notification for a due unfired reminder and stamps fired_at', async () => {
    const f = await seedDue({ remindAt: new Date('2026-05-20T00:00:00.000Z') });
    const fired = await scanReminders(db, new Date('2026-05-22T00:00:00.000Z'));
    expect(fired).toBe(1);

    const notes = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, f.userId));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type).toBe('reminder');

    const [r] = await db
      .select()
      .from(schema.reminders)
      .where(eq(schema.reminders.id, f.reminderId));
    expect(r?.firedAt).not.toBeNull();
  });

  it('does not fire a future reminder, and does not double-fire an already-fired one', async () => {
    await seedDue({ remindAt: new Date('2030-01-01T00:00:00.000Z') });
    expect(await scanReminders(db, new Date('2026-05-22T00:00:00.000Z'))).toBe(0);

    await seedDue({ remindAt: new Date('2026-05-20T00:00:00.000Z') });
    expect(await scanReminders(db, new Date('2026-05-22T00:00:00.000Z'))).toBe(1);
    expect(await scanReminders(db, new Date('2026-05-22T00:00:00.000Z'))).toBe(0);
  });
});
