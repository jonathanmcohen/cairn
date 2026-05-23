import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { setRowParent } from '@/lib/databases/hierarchy';
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

async function makeRow(databaseId: string, userId: string) {
  const [row] = await db
    .insert(schema.dbRows)
    .values({ databaseId, createdBy: userId })
    .returning();
  if (!row) throw new Error('row insert failed');
  return row;
}

describe('setRowParent', () => {
  it('sets a parent on a row in the same database', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const parent = await makeRow(d.id, u.userId);
    const child = await makeRow(d.id, u.userId);

    await db.transaction((tx) => setRowParent(tx, { rowId: child.id, parentId: parent.id }));

    const [updated] = await db.select().from(schema.dbRows).where(eq(schema.dbRows.id, child.id));
    expect(updated?.parentRowId).toBe(parent.id);
  });

  it('clears the parent when parentId is null', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const parent = await makeRow(d.id, u.userId);
    const child = await makeRow(d.id, u.userId);
    await db.transaction((tx) => setRowParent(tx, { rowId: child.id, parentId: parent.id }));

    await db.transaction((tx) => setRowParent(tx, { rowId: child.id, parentId: null }));

    const [updated] = await db.select().from(schema.dbRows).where(eq(schema.dbRows.id, child.id));
    expect(updated?.parentRowId).toBeNull();
  });

  it('rejects a row parenting itself', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const row = await makeRow(d.id, u.userId);

    await expect(
      db.transaction((tx) => setRowParent(tx, { rowId: row.id, parentId: row.id })),
    ).rejects.toThrow(/cycle|ancestor|itself/i);
  });

  it('rejects a cycle through an ancestor chain (a→b→c, then a as child of c)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const a = await makeRow(d.id, u.userId);
    const b = await makeRow(d.id, u.userId);
    const c = await makeRow(d.id, u.userId);
    // b's parent = a, c's parent = b  (chain c→b→a)
    await db.transaction((tx) => setRowParent(tx, { rowId: b.id, parentId: a.id }));
    await db.transaction((tx) => setRowParent(tx, { rowId: c.id, parentId: b.id }));

    // Now try to make a a child of c — would form a cycle a→c→b→a.
    await expect(
      db.transaction((tx) => setRowParent(tx, { rowId: a.id, parentId: c.id })),
    ).rejects.toThrow(/cycle|ancestor/i);
  });

  it('rejects a parent in a different database', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d1 = await makeDatabase(u.workspaceId, u.userId);
    const d2 = await makeDatabase(u.workspaceId, u.userId);
    const child = await makeRow(d1.id, u.userId);
    const foreignParent = await makeRow(d2.id, u.userId);

    await expect(
      db.transaction((tx) => setRowParent(tx, { rowId: child.id, parentId: foreignParent.id })),
    ).rejects.toThrow(/same database|not found/i);
  });

  it('rejects an unknown row or parent', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await makeDatabase(u.workspaceId, u.userId);
    const row = await makeRow(d.id, u.userId);
    const missing = '00000000-0000-0000-0000-000000000000';

    await expect(
      db.transaction((tx) => setRowParent(tx, { rowId: row.id, parentId: missing })),
    ).rejects.toThrow(/not found/i);
    await expect(
      db.transaction((tx) => setRowParent(tx, { rowId: missing, parentId: row.id })),
    ).rejects.toThrow(/not found/i);
  });
});
