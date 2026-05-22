import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
import { listCommentsByTarget } from '@/lib/comments/list';
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
  await sql`TRUNCATE comments, notifications, files, db_cells, db_rows, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function seedRow(workspaceId: string, userId: string) {
  const p = await createPage(db, { workspaceId, createdBy: userId });
  const [d] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: p.id, createdBy: userId })
    .returning();
  if (!d) throw new Error('db');
  const [row] = await db
    .insert(schema.dbRows)
    .values({ databaseId: d.id, createdBy: userId })
    .returning();
  if (!row) throw new Error('row');
  return { pageId: p.id, rowId: row.id };
}

describe('listCommentsByTarget', () => {
  it('returns only comments for the given row target, oldest first', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { rowId } = await seedRow(u.workspaceId, u.userId);
    const a = await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body: '1',
      target: { type: 'db_row', id: rowId },
    });
    const b = await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body: '2',
      target: { type: 'db_row', id: rowId },
    });
    const list = await listCommentsByTarget(db, { type: 'db_row', id: rowId }, u.workspaceId);
    expect(list.map((c) => c.id)).toEqual([a.comment.id, b.comment.id]);
  });

  it('does not mix targets that happen to share a page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { pageId, rowId } = await seedRow(u.workspaceId, u.userId);
    await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body: 'page',
      target: { type: 'page', id: pageId },
    });
    await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body: 'row',
      target: { type: 'db_row', id: rowId },
    });
    const rowList = await listCommentsByTarget(db, { type: 'db_row', id: rowId }, u.workspaceId);
    expect(rowList).toHaveLength(1);
    expect(rowList[0]?.body).toBe('row');
  });

  it('does not leak comments from another workspace', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { rowId } = await seedRow(u.workspaceId, u.userId);
    await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body: 'mine',
      target: { type: 'db_row', id: rowId },
    });
    const list = await listCommentsByTarget(
      db,
      { type: 'db_row', id: rowId },
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    );
    expect(list).toHaveLength(0);
  });
});
