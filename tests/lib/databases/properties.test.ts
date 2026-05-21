import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { createProperty, deleteProperty, updateProperty } from '@/lib/databases/properties';
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

describe('property CRUD', () => {
  it('createProperty appends at next position', async () => {
    const { u, d } = await setup();
    const p1 = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Status',
      type: 'text',
    });
    const p2 = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Priority',
      type: 'number',
    });
    expect(p1.position).toBeGreaterThanOrEqual(1);
    expect(p2.position).toBeGreaterThan(p1.position);
  });

  it('validates select config (options array)', async () => {
    const { u, d } = await setup();
    const ok = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Stage',
      type: 'select',
      config: {
        options: [
          { id: 'todo', name: 'Todo' },
          { id: 'done', name: 'Done' },
        ],
      },
    });
    const cfg = ok.config as { options: { id: string }[] };
    expect(cfg.options).toHaveLength(2);

    await expect(
      createProperty(db, {
        databaseId: d.id,
        workspaceId: u.workspaceId,
        name: 'Bad',
        type: 'select',
        config: { options: 'not an array' },
      }),
    ).rejects.toThrow();
  });

  it('rejects cross-workspace property writes', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    const d = await createDatabase(db, {
      workspaceId: b.workspaceId,
      pageId: page.id,
      createdBy: b.userId,
    });
    await expect(
      createProperty(db, {
        databaseId: d.id,
        workspaceId: a.workspaceId,
        name: 'X',
        type: 'text',
      }),
    ).rejects.toThrow(/database.*workspace/i);
  });

  it('updateProperty renames + re-validates config', async () => {
    const { u, d } = await setup();
    const prop = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Status',
      type: 'select',
      config: { options: [{ id: 'a', name: 'A' }] },
    });
    const updated = await updateProperty(db, {
      propertyId: prop.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      patch: {
        name: 'Stage',
        config: {
          options: [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
          ],
        },
      },
    });
    expect(updated.name).toBe('Stage');
    expect((updated.config as { options: unknown[] }).options).toHaveLength(2);
  });

  it('deleteProperty cascades cells', async () => {
    const { u, d } = await setup();
    const prop = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'X',
      type: 'text',
    });
    const [row] = await db
      .insert(schema.dbRows)
      .values({ databaseId: d.id, createdBy: u.userId })
      .returning();
    if (!row) throw new Error('no row');
    await db.insert(schema.dbCells).values({ rowId: row.id, propertyId: prop.id, value: 'hello' });
    await deleteProperty(db, {
      propertyId: prop.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
    });
    const cells = await db.select().from(schema.dbCells);
    expect(cells).toEqual([]);
  });
});
