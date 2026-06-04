import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { createRow, getRowDetail, updateRowBody } from '@/lib/databases/rows';
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
  const titleProp = (await db.select().from(schema.dbProperties))[0];
  if (!titleProp) throw new Error('no seeded property');
  return { u, d, titleProp };
}

describe('db_rows.body column + getRowDetail/updateRowBody', () => {
  it('body defaults to null for a fresh row', async () => {
    const { u, d } = await setup();
    const r = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    const [row] = await db
      .select({ body: schema.dbRows.body })
      .from(schema.dbRows)
      .where(eq(schema.dbRows.id, r.id));
    expect(row?.body).toBeNull();
  });

  it('getRowDetail returns { row, cells, body } with body null for a fresh row', async () => {
    const { u, d, titleProp } = await setup();
    const r = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [titleProp.id]: 'Hello' },
    });
    const detail = await getRowDetail(db, {
      rowId: r.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
    });
    expect(detail.row.id).toBe(r.id);
    expect(detail.cells[titleProp.id]).toBe('Hello');
    expect(detail.body).toBeNull();
  });

  it('updateRowBody persists a body document and getRowDetail reads it back', async () => {
    const { u, d } = await setup();
    const r = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    await updateRowBody(db, {
      rowId: r.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      body: doc,
    });
    const detail = await getRowDetail(db, {
      rowId: r.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
    });
    expect(detail.body).toEqual(doc);
  });

  it('getRowDetail rejects a cross-workspace row', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const pageB = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    const dB = await createDatabase(db, {
      workspaceId: b.workspaceId,
      pageId: pageB.id,
      createdBy: b.userId,
    });
    const rB = await createRow(db, {
      databaseId: dB.id,
      workspaceId: b.workspaceId,
      createdBy: b.userId,
    });
    await expect(
      getRowDetail(db, { rowId: rB.id, databaseId: dB.id, workspaceId: a.workspaceId }),
    ).rejects.toThrow(/not found/i);
  });
});
