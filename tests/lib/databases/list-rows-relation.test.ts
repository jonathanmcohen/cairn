import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createProperty } from '@/lib/databases/properties';
import { archiveRow, createRow, listRows } from '@/lib/databases/rows';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, databases, db_properties, db_rows, db_cells RESTART IDENTITY CASCADE`;
});

async function makeDb(workspaceId: string, userId: string) {
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: userId })
    .returning();
  if (!page) throw new Error('page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, createdBy: userId })
    .returning();
  if (!database) throw new Error('db');
  return database.id;
}

async function setup() {
  const u = await createTestWorkspaceWithUser(db);
  const target = await makeDb(u.workspaceId, u.userId);
  const source = await makeDb(u.workspaceId, u.userId);
  // target db has a text "Name" property used as the display label
  const name = await createProperty(db, {
    databaseId: target,
    workspaceId: u.workspaceId,
    name: 'Name',
    type: 'text',
  });
  const rel = await createProperty(db, {
    databaseId: source,
    workspaceId: u.workspaceId,
    name: 'Linked',
    type: 'relation',
    config: { targetDatabaseId: target },
  });
  const t1 = await createRow(db, {
    databaseId: target,
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    cells: { [name.id]: 'Alpha' },
  });
  const t2 = await createRow(db, {
    databaseId: target,
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    cells: { [name.id]: 'Beta' },
  });
  return { ...u, source, target, rel, name, t1, t2 };
}

describe('listRows relation resolution', () => {
  it('resolves relation cells to ids + labels', async () => {
    const s = await setup();
    await createRow(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.rel.id]: [s.t1.id, s.t2.id] },
    });
    const rows = await listRows(db, { databaseId: s.source, workspaceId: s.workspaceId });
    const cell = rows[0]?.cells[s.rel.id] as { ids: string[]; labels: string[] };
    expect(cell.ids).toEqual([s.t1.id, s.t2.id]);
    expect(cell.labels).toEqual(['Alpha', 'Beta']);
  });

  it('filters out dangling ids (archived/deleted related rows) on read', async () => {
    const s = await setup();
    await createRow(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.rel.id]: [s.t1.id, s.t2.id] },
    });
    // Archive t2 — the relation cell is NOT eagerly rewritten...
    await archiveRow(db, {
      rowId: s.t2.id,
      databaseId: s.target,
      workspaceId: s.workspaceId,
    });
    // ...but the stored value still has both ids.
    const stored = await db
      .select()
      .from(schema.dbCells)
      .where(eq(schema.dbCells.propertyId, s.rel.id));
    expect((stored[0]?.value as string[]).length).toBe(2);
    // Read drops the dangling id.
    const rows = await listRows(db, { databaseId: s.source, workspaceId: s.workspaceId });
    const cell = rows[0]?.cells[s.rel.id] as { ids: string[]; labels: string[] };
    expect(cell.ids).toEqual([s.t1.id]);
    expect(cell.labels).toEqual(['Alpha']);
  });

  it('falls back to a placeholder label when the target row has no label cell', async () => {
    const s = await setup();
    const t3 = await createRow(db, {
      databaseId: s.target,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
    }); // no Name cell
    await createRow(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.rel.id]: [t3.id] },
    });
    const rows = await listRows(db, { databaseId: s.source, workspaceId: s.workspaceId });
    const cell = rows[0]?.cells[s.rel.id] as { ids: string[]; labels: string[] };
    expect(cell.ids).toEqual([t3.id]);
    expect(cell.labels[0]).toMatch(/untitled/i);
  });
});
