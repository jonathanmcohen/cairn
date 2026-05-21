import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createProperty } from '@/lib/databases/properties';
import { createRow, listRows, updateCells } from '@/lib/databases/rows';
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
  const other = await makeDb(u.workspaceId, u.userId);
  const source = await makeDb(u.workspaceId, u.userId);
  const rel = await createProperty(db, {
    databaseId: source,
    workspaceId: u.workspaceId,
    name: 'Linked',
    type: 'relation',
    config: { targetDatabaseId: target },
  });
  const targetRow = await createRow(db, {
    databaseId: target,
    workspaceId: u.workspaceId,
    createdBy: u.userId,
  });
  const otherRow = await createRow(db, {
    databaseId: other,
    workspaceId: u.workspaceId,
    createdBy: u.userId,
  });
  return { ...u, source, target, rel, targetRow, otherRow };
}

describe('relation write-time validation', () => {
  it('accepts ids that are live rows in the target database', async () => {
    const s = await setup();
    const row = await createRow(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.rel.id]: [s.targetRow.id] },
    });
    const rows = await listRows(db, { databaseId: s.source, workspaceId: s.workspaceId });
    const stored = rows.find((r) => r.row.id === row.id)?.cells[s.rel.id] as
      | { ids: string[] }
      | undefined;
    expect(stored?.ids).toEqual([s.targetRow.id]);
  });

  it('rejects an id that does not resolve to any row', async () => {
    const s = await setup();
    await expect(
      createRow(db, {
        databaseId: s.source,
        workspaceId: s.workspaceId,
        createdBy: s.userId,
        cells: { [s.rel.id]: ['00000000-0000-0000-0000-000000000000'] },
      }),
    ).rejects.toThrow(/relation/i);
  });

  it('rejects an id that belongs to a different database', async () => {
    const s = await setup();
    await expect(
      createRow(db, {
        databaseId: s.source,
        workspaceId: s.workspaceId,
        createdBy: s.userId,
        cells: { [s.rel.id]: [s.otherRow.id] },
      }),
    ).rejects.toThrow(/relation/i);
  });

  it('updateCells enforces the same membership rule', async () => {
    const s = await setup();
    const row = await createRow(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
    });
    await expect(
      updateCells(db, {
        rowId: row.id,
        databaseId: s.source,
        workspaceId: s.workspaceId,
        cells: { [s.rel.id]: [s.otherRow.id] },
      }),
    ).rejects.toThrow(/relation/i);
  });
});
