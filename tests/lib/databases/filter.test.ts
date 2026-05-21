import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { type FilterCondition, compileFilters } from '@/lib/databases/filter';
import { createProperty } from '@/lib/databases/properties';
import { createRow } from '@/lib/databases/rows';
import { createPage } from '@/lib/pages/create';
import { and, eq, isNull } from 'drizzle-orm';
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

async function countWithFilters(databaseId: string, conditions: FilterCondition[]) {
  const props = await db
    .select()
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.databaseId, databaseId));
  const propsById = new Map(props.map((p) => [p.id, p]));
  const filterClause = compileFilters(conditions, propsById);
  const where = filterClause
    ? and(eq(schema.dbRows.databaseId, databaseId), isNull(schema.dbRows.archivedAt), filterClause)
    : and(eq(schema.dbRows.databaseId, databaseId), isNull(schema.dbRows.archivedAt));
  const rows = await db.select().from(schema.dbRows).where(where);
  return rows.length;
}

describe('compileFilters', () => {
  it('text eq', async () => {
    const { u, d } = await setup();
    const prop = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Status',
      type: 'text',
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 'todo' },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 'done' },
    });
    const n = await countWithFilters(d.id, [{ propertyId: prop.id, op: 'eq', value: 'todo' }]);
    expect(n).toBe(1);
  });

  it('text contains (case-insensitive)', async () => {
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
      cells: { [prop.id]: 'Hello World' },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 'Other' },
    });
    const n = await countWithFilters(d.id, [
      { propertyId: prop.id, op: 'contains', value: 'hello' },
    ]);
    expect(n).toBe(1);
  });

  it('number gte', async () => {
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
      cells: { [prop.id]: 5 },
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
      cells: { [prop.id]: 100 },
    });
    const n = await countWithFilters(d.id, [{ propertyId: prop.id, op: 'gte', value: 50 }]);
    expect(n).toBe(2);
  });

  it('checkbox is_true', async () => {
    const { u, d } = await setup();
    const prop = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Done',
      type: 'checkbox',
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: true },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: false },
    });
    const n = await countWithFilters(d.id, [{ propertyId: prop.id, op: 'is_true', value: null }]);
    expect(n).toBe(1);
  });

  it('multi_select contains', async () => {
    const { u, d } = await setup();
    const prop = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Tags',
      type: 'multi_select',
      config: {
        options: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: ['a', 'b'] },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: ['c'] },
    });
    const n = await countWithFilters(d.id, [{ propertyId: prop.id, op: 'contains', value: 'a' }]);
    expect(n).toBe(1);
  });

  it('AND of two conditions', async () => {
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
      cells: { [stat.id]: 'todo', [score.id]: 100 },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [stat.id]: 'todo', [score.id]: 1 },
    });
    await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [stat.id]: 'done', [score.id]: 100 },
    });
    const n = await countWithFilters(d.id, [
      { propertyId: stat.id, op: 'eq', value: 'todo' },
      { propertyId: score.id, op: 'gte', value: 50 },
    ]);
    expect(n).toBe(1);
  });

  it('empty filter list returns all rows', async () => {
    const { u, d } = await setup();
    await createRow(db, { databaseId: d.id, workspaceId: u.workspaceId, createdBy: u.userId });
    await createRow(db, { databaseId: d.id, workspaceId: u.workspaceId, createdBy: u.userId });
    const n = await countWithFilters(d.id, []);
    expect(n).toBe(2);
  });
});
