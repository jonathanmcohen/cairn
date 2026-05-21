import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { createProperty } from '@/lib/databases/properties';
import { createView, deleteView, updateView } from '@/lib/databases/views';
import { createPage } from '@/lib/pages/create';
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
  await sql`TRUNCATE databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function setup() {
  const u = await createTestWorkspaceWithUser(db);
  const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
  const d = await createDatabase(db, {
    workspaceId: u.workspaceId,
    pageId: p.id,
    createdBy: u.userId,
  });
  return { u, d };
}

describe('view CRUD', () => {
  it('createView (table) succeeds with default config', async () => {
    const { u, d } = await setup();
    const v = await createView(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      type: 'table',
      name: 'Default',
    });
    expect(v.type).toBe('table');
    expect(v.name).toBe('Default');
  });

  it('createView (kanban) without groupBy is rejected', async () => {
    const { u, d } = await setup();
    await expect(
      createView(db, {
        databaseId: d.id,
        workspaceId: u.workspaceId,
        type: 'kanban',
        name: 'Board',
      }),
    ).rejects.toThrow(/groupBy/i);
  });

  it('createView (kanban) with groupBy succeeds', async () => {
    const { u, d } = await setup();
    const stat = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Status',
      type: 'select',
      config: { options: [] },
    });
    const v = await createView(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      type: 'kanban',
      name: 'Board',
      config: { groupBy: stat.id, sorts: [], filters: [], visibleProperties: [] },
    });
    expect(v.type).toBe('kanban');
  });

  it('updateView validates new config', async () => {
    const { u, d } = await setup();
    const v = await createView(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      type: 'table',
      name: 'X',
    });
    const updated = await updateView(db, {
      viewId: v.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      patch: {
        name: 'Renamed',
        config: { sorts: [], filters: [], groupBy: null, visibleProperties: [] },
      },
    });
    expect(updated.name).toBe('Renamed');
  });

  it('deleteView removes the row', async () => {
    const { u, d } = await setup();
    const v = await createView(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      type: 'gallery',
      name: 'Cards',
    });
    await deleteView(db, { viewId: v.id, databaseId: d.id, workspaceId: u.workspaceId });
    const remaining = await db.select().from(schema.dbViews).where(eq(schema.dbViews.id, v.id));
    expect(remaining).toEqual([]);
  });
});
