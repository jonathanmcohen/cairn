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
  await sql`TRUNCATE comments, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('v0.3.0 comments schema', () => {
  it('inserts a page-level comment (null anchor, null resolved_at)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('page insert failed');
    const [c] = await db
      .insert(schema.comments)
      .values({ workspaceId: u.workspaceId, pageId: p.id, authorId: u.userId, body: 'hi' })
      .returning();
    expect(c?.anchor).toBeNull();
    expect(c?.resolvedAt).toBeNull();
    expect(c?.createdAt).toBeInstanceOf(Date);
  });

  it('stores both anchor shapes round-trip', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('page insert failed');
    const [block] = await db
      .insert(schema.comments)
      .values({
        workspaceId: u.workspaceId,
        pageId: p.id,
        authorId: u.userId,
        body: 'b',
        anchor: { blockId: 'blk-1' },
      })
      .returning();
    const [range] = await db
      .insert(schema.comments)
      .values({
        workspaceId: u.workspaceId,
        pageId: p.id,
        authorId: u.userId,
        body: 'r',
        anchor: { from: 3, to: 9 },
      })
      .returning();
    expect(block?.anchor).toEqual({ blockId: 'blk-1' });
    expect(range?.anchor).toEqual({ from: 3, to: 9 });
  });

  it('cascades on page delete and restricts on author delete', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('page insert failed');
    await db
      .insert(schema.comments)
      .values({ workspaceId: u.workspaceId, pageId: p.id, authorId: u.userId, body: 'x' });
    // author delete is restricted while a comment references them
    await expect(db.delete(schema.users).where(eq(schema.users.id, u.userId))).rejects.toThrow();
    // page delete cascades
    await db.delete(schema.pages).where(eq(schema.pages.id, p.id));
    const rows = await db.select().from(schema.comments).where(eq(schema.comments.pageId, p.id));
    expect(rows).toHaveLength(0);
  });
});
