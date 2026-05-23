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
  const [status] = await db
    .insert(schema.dbProperties)
    .values({
      databaseId: database.id,
      name: 'Status',
      type: 'select',
      position: 0,
      config: { options: [{ id: 'a', name: 'A' }] },
    })
    .returning();
  if (!status) throw new Error('prop');
  return { ...u, databaseId: database.id, status };
}

describe('list view config', () => {
  it('creates an ungrouped list view', async () => {
    const s = await setup();
    const v = await createView(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      type: 'list',
      name: 'List',
      config: {},
    });
    expect(v.type).toBe('list');
  });

  it('creates a grouped list view', async () => {
    const s = await setup();
    const v = await createView(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      type: 'list',
      name: 'List',
      config: { groupBy: s.status.id },
    });
    expect((v.config as { groupBy?: string }).groupBy).toBe(s.status.id);
  });

  it('updates a list view config (multi-sort) without error', async () => {
    const s = await setup();
    const v = await createView(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      type: 'list',
      name: 'List',
      config: {},
    });
    const updated = await updateView(db, {
      viewId: v.id,
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      patch: {
        config: {
          sorts: [{ propertyId: s.status.id, direction: 'asc' }],
          groupBy: s.status.id,
        },
      },
    });
    const cfg = updated.config as { sorts?: unknown[]; groupBy?: string };
    expect(cfg.sorts).toHaveLength(1);
    expect(cfg.groupBy).toBe(s.status.id);
  });
});
