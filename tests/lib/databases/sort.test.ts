import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { createProperty } from '@/lib/databases/properties';
import { createRow, listRows } from '@/lib/databases/rows';
import { createPage } from '@/lib/pages/create';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('listRows with sorts', () => {
  it('sorts by number asc', async () => {
    const { u, d } = await setup();
    const prop = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Score',
      type: 'number',
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 50 },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 5 },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 100 },
    });
    const rows = await listRows(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      sorts: [{ propertyId: prop.id, direction: 'asc' }],
    });
    const values = rows.map((r) => r.cells[prop.id]);
    expect(values).toEqual([5, 50, 100]);
  });

  it('sorts by text desc', async () => {
    const { u, d } = await setup();
    const prop = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Name',
      type: 'text',
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 'Banana' },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 'Apple' },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 'Cherry' },
    });
    const rows = await listRows(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      sorts: [{ propertyId: prop.id, direction: 'desc' }],
    });
    const values = rows.map((r) => r.cells[prop.id]);
    expect(values).toEqual(['Cherry', 'Banana', 'Apple']);
  });

  it('filter + sort together', async () => {
    const { u, d } = await setup();
    const stat = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Status',
      type: 'text',
    });
    const score = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Score',
      type: 'number',
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [stat.id]: 'todo', [score.id]: 30 },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [stat.id]: 'todo', [score.id]: 10 },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [stat.id]: 'done', [score.id]: 99 },
    });
    const rows = await listRows(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      filters: [{ propertyId: stat.id, op: 'eq', value: 'todo' }],
      sorts: [{ propertyId: score.id, direction: 'desc' }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.cells[score.id] as number).toBe(30);
  });
});
