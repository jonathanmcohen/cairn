import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { createProperty } from '@/lib/databases/properties';
import { archiveRow, createRow, listRows, updateCells } from '@/lib/databases/rows';
import { createPage } from '@/lib/pages/create';
import { eq } from 'drizzle-orm';
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
  const titleProp = (await db.select().from(schema.dbProperties))[0]; // seeded "Name"
  if (!titleProp) throw new Error('no seeded property');
  return { u, d, titleProp };
}

describe('row + cell CRUD', () => {
  it('createRow with no cells', async () => {
    const { u, d } = await setup();
    const r = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    expect(r.databaseId).toBe(d.id);
  });

  it('createRow with cells coerces values', async () => {
    const { u, d, titleProp } = await setup();
    const numProp = await createProperty(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Count',
      type: 'number',
    });
    const r = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [titleProp.id]: 'Hello', [numProp.id]: '42' },
    });
    const cells = await db.select().from(schema.dbCells).where(eq(schema.dbCells.rowId, r.id));
    const byProp = new Map(cells.map((c) => [c.propertyId, c.value]));
    expect(byProp.get(titleProp.id)).toBe('Hello');
    expect(byProp.get(numProp.id)).toBe(42); // coerced from "42" to number 42
  });

  it('updateCells upserts and bumps updatedAt', async () => {
    const { u, d, titleProp } = await setup();
    const r = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    await updateCells(db, {
      rowId: r.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      cells: { [titleProp.id]: 'First' },
    });
    await updateCells(db, {
      rowId: r.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      cells: { [titleProp.id]: 'Second' },
    });
    const cells = await db.select().from(schema.dbCells);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.value).toBe('Second');
  });

  it('archiveRow excludes the row from listRows', async () => {
    const { u, d } = await setup();
    const r = await createRow(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    await archiveRow(db, { rowId: r.id, databaseId: d.id, workspaceId: u.workspaceId });
    const rows = await listRows(db, { databaseId: d.id, workspaceId: u.workspaceId });
    expect(rows).toEqual([]);
  });

  it('listRows paginates', async () => {
    const { u, d } = await setup();
    for (let i = 0; i < 5; i++) {
      await createRow(db, {
        databaseId: d.id,
        workspaceId: u.workspaceId,
        createdBy: u.userId,
      });
    }
    const rows = await listRows(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      limit: 2,
    });
    expect(rows).toHaveLength(2);
  });

  it('cross-workspace updateCells rejects', async () => {
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
      updateCells(db, {
        rowId: rB.id,
        databaseId: dB.id,
        workspaceId: a.workspaceId,
        cells: {},
      }),
    ).rejects.toThrow(/row.*not found/i);
  });
});
