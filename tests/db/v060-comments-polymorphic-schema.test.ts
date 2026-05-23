import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE comments, files, db_cells, db_rows, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('v0.6.0 polymorphic comments schema', () => {
  it('defaults target_type to page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('page insert failed');
    const [c] = await db
      .insert(schema.comments)
      .values({
        workspaceId: u.workspaceId,
        pageId: p.id,
        targetId: p.id,
        authorId: u.userId,
        body: 'hi',
      })
      .returning();
    expect(c?.targetType).toBe('page');
    expect(c?.targetId).toBe(p.id);
  });

  it('stores a db_row target with null page_id permitted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'DB page', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('page insert failed');
    const [d] = await db
      .insert(schema.databases)
      .values({ workspaceId: u.workspaceId, pageId: p.id, createdBy: u.userId })
      .returning();
    if (!d) throw new Error('db insert failed');
    const [row] = await db
      .insert(schema.dbRows)
      .values({ databaseId: d.id, createdBy: u.userId })
      .returning();
    if (!row) throw new Error('row insert failed');
    const [c] = await db
      .insert(schema.comments)
      .values({
        workspaceId: u.workspaceId,
        pageId: p.id,
        targetType: 'db_row',
        targetId: row.id,
        authorId: u.userId,
        body: 'row note',
      })
      .returning();
    expect(c?.targetType).toBe('db_row');
    expect(c?.targetId).toBe(row.id);
  });

  it('stores a file target', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [f] = await db
      .insert(schema.files)
      .values({
        workspaceId: u.workspaceId,
        name: 'a.png',
        mimeType: 'image/png',
        size: 10,
        path: '/x',
        uploadedBy: u.userId,
      })
      .returning();
    if (!f) throw new Error('file insert failed');
    const [c] = await db
      .insert(schema.comments)
      .values({
        workspaceId: u.workspaceId,
        pageId: null,
        targetType: 'file',
        targetId: f.id,
        authorId: u.userId,
        body: 'file note',
      })
      .returning();
    expect(c?.targetType).toBe('file');
    expect(c?.pageId).toBeNull();
    expect(c?.targetId).toBe(f.id);
  });

  it('still cascades page comments on page delete', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('page insert failed');
    await db.insert(schema.comments).values({
      workspaceId: u.workspaceId,
      pageId: p.id,
      targetId: p.id,
      authorId: u.userId,
      body: 'x',
    });
    await db.delete(schema.pages).where(eq(schema.pages.id, p.id));
    const rows = await db.select().from(schema.comments).where(eq(schema.comments.pageId, p.id));
    expect(rows).toHaveLength(0);
  });
});
