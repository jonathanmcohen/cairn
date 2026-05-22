import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { setRowParent } from '@/lib/databases/hierarchy';
import { createRow, listRows, updateCells } from '@/lib/databases/rows';
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
  await sql`TRUNCATE pages, databases, db_properties, db_rows, db_cells, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeDatabase(workspaceId: string, userId: string) {
  const page = await createPage(db, { workspaceId, createdBy: userId });
  const database = await createDatabase(db, {
    workspaceId,
    pageId: page.id,
    createdBy: userId,
  });
  return database;
}

describe('listRows parentRowId', () => {
  it('returns null parentRowId for top-level rows and the parent id for children', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const parent = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    const child = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    await db.transaction((tx) => setRowParent(tx, { rowId: child.id, parentId: parent.id }));

    const rows = await listRows(db, { databaseId: d.id, workspaceId: u.workspaceId });
    const byId = new Map(rows.map((r) => [r.row.id, r.row]));
    expect(byId.get(parent.id)?.parentRowId).toBeNull();
    expect(byId.get(child.id)?.parentRowId).toBe(parent.id);
  });
});

describe('createRow / updateCells parentRowId', () => {
  it('createRow sets a valid parent', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const parent = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    const child = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentRowId: parent.id,
    });
    expect(child.parentRowId).toBe(parent.id);
  });

  it('createRow rejects a parent from another database', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d1 = await makeDatabase(u.workspaceId, u.userId);
    const d2 = await makeDatabase(u.workspaceId, u.userId);
    const foreign = await createRow(db, {
      databaseId: d2.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    await expect(
      createRow(db, {
        databaseId: d1.id,
        workspaceId: u.workspaceId,
        createdBy: u.userId,
        parentRowId: foreign.id,
      }),
    ).rejects.toThrow(/same database|not found/i);
  });

  it('updateCells sets and clears the parent', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const parent = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    const child = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });

    await updateCells(db, {
      rowId: child.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      cells: {},
      parentRowId: parent.id,
    });
    let rows = await listRows(db, { databaseId: d.id, workspaceId: u.workspaceId });
    expect(rows.find((r) => r.row.id === child.id)?.row.parentRowId).toBe(parent.id);

    await updateCells(db, {
      rowId: child.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      cells: {},
      parentRowId: null,
    });
    rows = await listRows(db, { databaseId: d.id, workspaceId: u.workspaceId });
    expect(rows.find((r) => r.row.id === child.id)?.row.parentRowId).toBeNull();
  });

  it('updateCells rejects a cycle', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const a = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    const b = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentRowId: a.id,
    });
    // Try to make a a child of b — cycle a→b→a.
    await expect(
      updateCells(db, {
        rowId: a.id,
        databaseId: d.id,
        workspaceId: u.workspaceId,
        cells: {},
        parentRowId: b.id,
      }),
    ).rejects.toThrow(/cycle|ancestor/i);
  });

  it('updateCells leaves the parent untouched when parentRowId is omitted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const parent = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    const child = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentRowId: parent.id,
    });
    await updateCells(db, {
      rowId: child.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      cells: {},
    });
    const rows = await listRows(db, { databaseId: d.id, workspaceId: u.workspaceId });
    expect(rows.find((r) => r.row.id === child.id)?.row.parentRowId).toBe(parent.id);
  });
});
