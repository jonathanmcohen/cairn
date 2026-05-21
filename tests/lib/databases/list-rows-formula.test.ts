import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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

async function setup() {
  const u = await createTestWorkspaceWithUser(db);
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
    .returning();
  if (!page) throw new Error('page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId: u.workspaceId, pageId: page.id, createdBy: u.userId })
    .returning();
  if (!database) throw new Error('db');
  const [price] = await db
    .insert(schema.dbProperties)
    .values({ databaseId: database.id, name: 'Price', type: 'number', position: 0 })
    .returning();
  const [qty] = await db
    .insert(schema.dbProperties)
    .values({ databaseId: database.id, name: 'Qty', type: 'number', position: 1 })
    .returning();
  const [total] = await db
    .insert(schema.dbProperties)
    .values({
      databaseId: database.id,
      name: 'Total',
      type: 'formula',
      position: 2,
      config: { expression: 'Price * Qty' },
    })
    .returning();
  const [bad] = await db
    .insert(schema.dbProperties)
    .values({
      databaseId: database.id,
      name: 'Bad',
      type: 'formula',
      position: 3,
      config: { expression: 'Nope + 1' },
    })
    .returning();
  if (!price || !qty || !total || !bad) throw new Error('props');
  return { ...u, databaseId: database.id, price, qty, total, bad };
}

describe('listRows formula pass', () => {
  it('computes a formula cell from sibling cells', async () => {
    const s = await setup();
    await createRow(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.price.id]: 10, [s.qty.id]: 3 },
    });
    const rows = await listRows(db, { databaseId: s.databaseId, workspaceId: s.workspaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cells[s.total.id]).toBe(30);
  });

  it('surfaces {__error} for an unresolvable reference', async () => {
    const s = await setup();
    await createRow(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.price.id]: 10, [s.qty.id]: 3 },
    });
    const rows = await listRows(db, { databaseId: s.databaseId, workspaceId: s.workspaceId });
    expect(rows[0]?.cells[s.bad.id]).toMatchObject({ __error: expect.any(String) });
  });

  it('treats a missing numeric input as null (coerced to 0), not a crash', async () => {
    const s = await setup();
    await createRow(db, {
      databaseId: s.databaseId,
      workspaceId: s.workspaceId,
      createdBy: s.userId,
      cells: { [s.price.id]: 10 }, // Qty unset → null → 0
    });
    const rows = await listRows(db, { databaseId: s.databaseId, workspaceId: s.workspaceId });
    // null arithmetic is well-defined (Number(null) === 0); Price * Qty = 10 * 0 = 0.
    expect(rows[0]?.cells[s.total.id]).toBe(0);
  });
});
