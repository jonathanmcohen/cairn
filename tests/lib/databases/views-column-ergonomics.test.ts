import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createView, updateView } from '@/lib/databases/views';
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
  await sql`TRUNCATE db_views, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeDatabase(workspaceId: string, userId: string) {
  const page = await createPage(db, { workspaceId, createdBy: userId });
  const [d] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, name: 'D', createdBy: userId })
    .returning();
  if (!d) throw new Error('database insert failed');
  return d;
}
async function makeProperty(databaseId: string) {
  const [p] = await db
    .insert(schema.dbProperties)
    .values({ databaseId, name: 'Col', type: 'text', position: 0 })
    .returning();
  if (!p) throw new Error('property insert failed');
  return p;
}

describe('column ergonomics in view config', () => {
  it('persists columnWidths / frozenColumnIds / hiddenColumnIds on a table view', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const prop = await makeProperty(d.id);
    const view = await createView(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      type: 'table',
      name: 'Table',
    });

    const updated = await updateView(db, {
      viewId: view.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      patch: {
        config: {
          columnWidths: { [prop.id]: 240 },
          frozenColumnIds: [prop.id],
          hiddenColumnIds: [],
        },
      },
    });
    const cfg = updated.config as {
      columnWidths: Record<string, number>;
      frozenColumnIds: string[];
      hiddenColumnIds: string[];
    };
    expect(cfg.columnWidths[prop.id]).toBe(240);
    expect(cfg.frozenColumnIds).toEqual([prop.id]);
    expect(cfg.hiddenColumnIds).toEqual([]);

    const [reloaded] = await db.select().from(schema.dbViews).where(eq(schema.dbViews.id, view.id));
    expect(
      (reloaded?.config as { columnWidths: Record<string, number> }).columnWidths[prop.id],
    ).toBe(240);
  });

  it('defaults the three fields to empty when omitted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const view = await createView(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      type: 'table',
      name: 'T',
    });
    const cfg = view.config as {
      columnWidths: Record<string, number>;
      frozenColumnIds: string[];
      hiddenColumnIds: string[];
    };
    expect(cfg.columnWidths).toEqual({});
    expect(cfg.frozenColumnIds).toEqual([]);
    expect(cfg.hiddenColumnIds).toEqual([]);
  });

  it('rejects a non-positive or non-integer column width', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const prop = await makeProperty(d.id);
    const view = await createView(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      type: 'table',
      name: 'T',
    });
    await expect(
      updateView(db, {
        viewId: view.id,
        databaseId: d.id,
        workspaceId: u.workspaceId,
        patch: { config: { columnWidths: { [prop.id]: 0 } } },
      }),
    ).rejects.toThrow();
  });
});
