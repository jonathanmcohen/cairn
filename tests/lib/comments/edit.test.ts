import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
import { editComment } from '@/lib/comments/edit';
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

// Helper: insert an extra user into the same workspace with a given role.
async function addUser(workspaceId: string, email: string, role: schema.MemberRole = 'editor') {
  const [user] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: email })
    .returning();
  if (!user) throw new Error('user insert failed');
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: user.id, role });
  return user.id;
}

describe('editComment', () => {
  it('lets the author edit their own comment', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment } = await createComment(db, {
      workspaceId: u.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: u.userId,
      body: 'taht',
    });
    const updated = await editComment(db, {
      commentId: comment.id,
      workspaceId: u.workspaceId,
      actorId: u.userId,
      actorRole: 'editor',
      body: 'that',
    });
    expect(updated.body).toBe('that');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(updated.createdAt.getTime());
  });

  it('rejects a non-author editor with 403', async () => {
    const author = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const p = await createPage(db, { workspaceId: author.workspaceId, createdBy: author.userId });
    const { comment } = await createComment(db, {
      workspaceId: author.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: author.userId,
      body: 'x',
    });
    const otherId = await addUser(author.workspaceId, 'other@x.com', 'editor');
    await expect(
      editComment(db, {
        commentId: comment.id,
        workspaceId: author.workspaceId,
        actorId: otherId,
        actorRole: 'editor',
        body: 'hijack',
      }),
    ).rejects.toMatchObject({ status: 403, message: 'Only the author can edit this comment' });
    const [row] = await db.select().from(schema.comments).where(eq(schema.comments.id, comment.id));
    expect(row?.body).toBe('x');
  });

  it('rejects a non-author admin with 403 (edit is author-only)', async () => {
    const author = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const p = await createPage(db, { workspaceId: author.workspaceId, createdBy: author.userId });
    const { comment } = await createComment(db, {
      workspaceId: author.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: author.userId,
      body: 'x',
    });
    const adminId = await addUser(author.workspaceId, 'admin@x.com', 'admin');
    await expect(
      editComment(db, {
        commentId: comment.id,
        workspaceId: author.workspaceId,
        actorId: adminId,
        actorRole: 'admin',
        body: 'rewrite',
      }),
    ).rejects.toMatchObject({ status: 403, message: 'Only the author can edit this comment' });
  });

  it('rejects an empty/whitespace body', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment } = await createComment(db, {
      workspaceId: u.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: u.userId,
      body: 'x',
    });
    await expect(
      editComment(db, {
        commentId: comment.id,
        workspaceId: u.workspaceId,
        actorId: u.userId,
        actorRole: 'editor',
        body: '   ',
      }),
    ).rejects.toThrow('comment body is required');
  });

  it('throws 404 for a comment in another workspace (no existence leak)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const other = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: other.workspaceId, createdBy: other.userId });
    const { comment } = await createComment(db, {
      workspaceId: other.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: other.userId,
      body: 'x',
    });
    await expect(
      editComment(db, {
        commentId: comment.id,
        workspaceId: u.workspaceId,
        actorId: u.userId,
        actorRole: 'owner',
        body: 'sneaky',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'Comment not found' });
  });
});
