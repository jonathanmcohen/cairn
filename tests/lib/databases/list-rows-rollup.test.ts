import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createProperty } from '@/lib/databases/properties';
import { createRow, listRows } from '@/lib/databases/rows';
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

// Target db with a Price (number) property; source db with a relation -> target
// and two rollups over Price (sum + count).
async function setup() {
  const u = await createTestWorkspaceWithUser(db);
  const target = await makeDb(u.workspaceId, u.userId);
  const source = await makeDb(u.workspaceId, u.userId);
  const price = await createProperty(db, {
    databaseId: target,
    workspaceId: u.workspaceId,
    name: 'Price',
    type: 'number',
  });
  const rel = await createProperty(db, {
    databaseId: source,
    workspaceId: u.workspaceId,
    name: 'Linked',
    type: 'relation',
    config: { targetDatabaseId: target },
  });
  const total = await createProperty(db, {
    databaseId: source,
    workspaceId: u.workspaceId,
    name: 'Total',
    type: 'rollup',
    config: { relationPropertyId: rel.id, targetPropertyId: price.id, fn: 'sum' },
  });
  const howMany = await createProperty(db, {
    databaseId: source,
    workspaceId: u.workspaceId,
    name: 'Count',
    type: 'rollup',
    config: { relationPropertyId: rel.id, targetPropertyId: price.id, fn: 'count' },
  });
  const t1 = await createRow(db, {
    databaseId: target,
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    cells: { [price.id]: 10 },
  });
  const t2 = await createRow(db, {
    databaseId: target,
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    cells: { [price.id]: 25 },
  });
  return { ...u, source, target, price, rel, total, howMany, t1, t2 };
}

describe('listRows rollup pass', () => {
  it('aggregates a target property across related rows (sum + count)', async () => {
    const s = await setup();
    await createRow(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.rel.id]: [s.t1.id, s.t2.id] },
    });
    const rows = await listRows(db, { databaseId: s.source, workspaceId: s.workspaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cells[s.total.id]).toBe(35);
    expect(rows[0]?.cells[s.howMany.id]).toBe(2);
  });

  it('returns the empty-set defaults when the relation is empty', async () => {
    const s = await setup();
    await createRow(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      // no relation cell set
    });
    const rows = await listRows(db, { databaseId: s.source, workspaceId: s.workspaceId });
    expect(rows[0]?.cells[s.total.id]).toBe(0); // sum of empty set
    expect(rows[0]?.cells[s.howMany.id]).toBe(0); // count of empty set
  });

  it('aggregates independently per source row (no cross-contamination)', async () => {
    const s = await setup();
    const rowA = await createRow(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.rel.id]: [s.t1.id] }, // Price 10
    });
    const rowB = await createRow(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.rel.id]: [s.t1.id, s.t2.id] }, // 10 + 25
    });
    const rows = await listRows(db, { databaseId: s.source, workspaceId: s.workspaceId });
    const byId = new Map(rows.map((r) => [r.row.id, r.cells]));
    expect(byId.get(rowA.id)?.[s.total.id]).toBe(10);
    expect(byId.get(rowB.id)?.[s.total.id]).toBe(35);
  });
});
