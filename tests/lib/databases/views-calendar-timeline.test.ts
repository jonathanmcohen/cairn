import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createView, updateView } from '@/lib/databases/views';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, databases, db_properties, db_views RESTART IDENTITY CASCADE`;
});

async function setup() {
  const u = await createTestWorkspaceWithUser(db);
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
    .returning();
  if (!page) throw new Error('page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId: u.workspaceId, pageId: page.id, createdBy: u.userId })
    .returning();
  if (!database) throw new Error('db');
  const [due] = await db
    .insert(schema.dbProperties)
    .values({ databaseId: database.id, name: 'Due', type: 'date', position: 0 })
    .returning();
  const [start] = await db
    .insert(schema.dbProperties)
    .values({ databaseId: database.id, name: 'Start', type: 'date', position: 1 })
    .returning();
  const [end] = await db
    .insert(schema.dbProperties)
    .values({ databaseId: database.id, name: 'End', type: 'date', position: 2 })
    .returning();
  if (!due || !start || !end) throw new Error('props');
  return { ...u, databaseId: database.id, due, start, end };
}

describe('calendar/timeline view config validation', () => {
  it('creates a calendar view with a dateProperty', async () => {
    const s = await setup();
    const v = await createView(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      type: 'calendar',
      name: 'Calendar',
      config: { dateProperty: s.due.id },
    });
    expect(v.type).toBe('calendar');
    expect((v.config as { dateProperty?: string }).dateProperty).toBe(s.due.id);
  });

  it('rejects a calendar view without a dateProperty', async () => {
    const s = await setup();
    await expect(
      createView(db, {
        databaseId: s.databaseId,
        workspaceId: s.workspaceId,
        type: 'calendar',
        name: 'Calendar',
        config: {},
      }),
    ).rejects.toThrow(/calendar view requires/i);
  });

  it('creates a timeline view with a single dateProperty', async () => {
    const s = await setup();
    const v = await createView(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      type: 'timeline',
      name: 'Timeline',
      config: { dateProperty: s.due.id },
    });
    expect(v.type).toBe('timeline');
  });

  it('creates a timeline view with a start/end pair', async () => {
    const s = await setup();
    const v = await createView(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      type: 'timeline',
      name: 'Timeline',
      config: { startProperty: s.start.id, endProperty: s.end.id },
    });
    expect((v.config as { endProperty?: string }).endProperty).toBe(s.end.id);
  });

  it('rejects a timeline view with neither a dateProperty nor a start/end pair', async () => {
    const s = await setup();
    await expect(
      createView(db, {
        databaseId: s.databaseId,
        workspaceId: s.workspaceId,
        type: 'timeline',
        name: 'Timeline',
        config: { startProperty: s.start.id }, // endProperty missing
      }),
    ).rejects.toThrow(/timeline view requires/i);
  });

  it('updateView re-validates the calendar dateProperty', async () => {
    const s = await setup();
    const v = await createView(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      type: 'calendar',
      name: 'Calendar',
      config: { dateProperty: s.due.id },
    });
    await expect(
      updateView(db, {
        viewId: v.id,
        databaseId: s.databaseId,
        workspaceId: s.workspaceId,
        patch: { config: {} },
      }),
    ).rejects.toThrow(/calendar view requires/i);
  });
});
