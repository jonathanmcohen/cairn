import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
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
  await sql`TRUNCATE page_versions, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

const doc = (s: string) => ({ type: 'doc', content: [{ type: 'paragraph', text: s }] });

describe('page_versions table', () => {
  it('inserts and reads a version row', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });

    const [row] = await db
      .insert(schema.pageVersions)
      .values({ pageId: page.id, content: doc('hello'), authorId: u.userId })
      .returning();

    expect(row).toBeDefined();
    expect(row?.pageId).toBe(page.id);
    expect(row?.authorId).toBe(u.userId);
    expect(row?.content).toEqual(doc('hello'));
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it('cascades delete when the page is deleted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await db
      .insert(schema.pageVersions)
      .values({ pageId: page.id, content: doc('x'), authorId: u.userId });

    await db.delete(schema.pages).where(eq(schema.pages.id, page.id));

    const remaining = await db
      .select()
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.pageId, page.id));
    expect(remaining).toHaveLength(0);
  });

  it('sets author_id to null when the author user is deleted', async () => {
    const owner = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: owner.workspaceId,
      createdBy: owner.userId,
    });

    // A distinct author user (pages.created_by is ON DELETE RESTRICT, so the
    // version author must be a separate, deletable user).
    const [author] = await db
      .insert(schema.users)
      .values({ email: `author-${page.id}@example.com`, passwordHash: 'h', name: 'author' })
      .returning();
    const authorId = author?.id;
    expect(authorId).toBeDefined();

    const [row] = await db
      .insert(schema.pageVersions)
      .values({ pageId: page.id, content: doc('y'), authorId })
      .returning();
    expect(row?.authorId).toBe(authorId);

    await db.delete(schema.users).where(eq(schema.users.id, authorId ?? ''));

    const [after] = await db
      .select()
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.id, row?.id ?? ''));
    expect(after?.authorId).toBeNull();
  });
});
