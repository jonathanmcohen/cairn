import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
import { listComments } from '@/lib/comments/list';
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
  await sql`TRUNCATE comments, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('listComments', () => {
  it('returns comments ordered by created_at, oldest first', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment: a } = await createComment(db, {
      workspaceId: u.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: u.userId,
      body: 'first',
    });
    const { comment: b } = await createComment(db, {
      workspaceId: u.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: u.userId,
      body: 'second',
    });
    const list = await listComments(db, p.id, u.workspaceId);
    expect(list.map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it('includes resolved comments with resolvedAt populated', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment: c } = await createComment(db, {
      workspaceId: u.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: u.userId,
      body: 'done',
    });
    await db
      .update(schema.comments)
      .set({ resolvedAt: new Date() })
      .where(eq(schema.comments.id, c.id));
    const list = await listComments(db, p.id, u.workspaceId);
    expect(list).toHaveLength(1);
    expect(list[0]?.resolvedAt).toBeInstanceOf(Date);
  });

  it('does not leak comments from another workspace', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await createComment(db, {
      workspaceId: u.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: u.userId,
      body: 'mine',
    });
    const list = await listComments(db, p.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(list).toHaveLength(0);
  });
});
