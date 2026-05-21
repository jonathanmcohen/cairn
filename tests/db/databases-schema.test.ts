import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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

describe('databases schema', () => {
  it('creates a database under a page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [page] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!page) throw new Error('no page');
    const [d] = await db
      .insert(schema.databases)
      .values({
        workspaceId: u.workspaceId,
        pageId: page.id,
        createdBy: u.userId,
        name: 'My DB',
      })
      .returning();
    expect(d?.name).toBe('My DB');
  });

  it('creates a property + row + cell flow', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [page] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!page) throw new Error('no page');
    const [d] = await db
      .insert(schema.databases)
      .values({ workspaceId: u.workspaceId, pageId: page.id, createdBy: u.userId })
      .returning();
    if (!d) throw new Error('no db');
    const [prop] = await db
      .insert(schema.dbProperties)
      .values({ databaseId: d.id, name: 'Name', type: 'text' })
      .returning();
    if (!prop) throw new Error('no prop');
    const [row] = await db
      .insert(schema.dbRows)
      .values({ databaseId: d.id, createdBy: u.userId })
      .returning();
    if (!row) throw new Error('no row');
    await db.insert(schema.dbCells).values({ rowId: row.id, propertyId: prop.id, value: 'Hello' });
    const cells = await db.select().from(schema.dbCells);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.value).toBe('Hello');
  });

  it('cascades cell delete when row is deleted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [page] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!page) throw new Error('no page');
    const [d] = await db
      .insert(schema.databases)
      .values({ workspaceId: u.workspaceId, pageId: page.id, createdBy: u.userId })
      .returning();
    if (!d) throw new Error('no db');
    const [prop] = await db
      .insert(schema.dbProperties)
      .values({ databaseId: d.id, name: 'X', type: 'text' })
      .returning();
    if (!prop) throw new Error('no prop');
    const [row] = await db
      .insert(schema.dbRows)
      .values({ databaseId: d.id, createdBy: u.userId })
      .returning();
    if (!row) throw new Error('no row');
    await db.insert(schema.dbCells).values({ rowId: row.id, propertyId: prop.id, value: 'X' });
    await sql`DELETE FROM db_rows WHERE id = ${row.id}`;
    const cells = await db.select().from(schema.dbCells);
    expect(cells).toEqual([]);
  });

  it('creates a view with type kanban', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [page] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!page) throw new Error('no page');
    const [d] = await db
      .insert(schema.databases)
      .values({ workspaceId: u.workspaceId, pageId: page.id, createdBy: u.userId })
      .returning();
    if (!d) throw new Error('no db');
    const [v] = await db
      .insert(schema.dbViews)
      .values({ databaseId: d.id, type: 'kanban', name: 'By Status' })
      .returning();
    expect(v?.type).toBe('kanban');
  });
});
