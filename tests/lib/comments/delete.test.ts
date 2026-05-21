import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
import { deleteComment } from '@/lib/comments/delete';
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

// Helper: insert an extra user into the same workspace and return their id.
async function addUser(workspaceId: string, email: string) {
  const [user] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: email })
    .returning();
  if (!user) throw new Error('user insert failed');
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: user.id, role: 'editor' });
  return user.id;
}

describe('deleteComment', () => {
  it('lets the author delete their own comment', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment: c } = await createComment(db, {
      workspaceId: u.workspaceId,
      pageId: p.id,
      authorId: u.userId,
      body: 'mine',
    });
    await deleteComment(db, {
      commentId: c.id,
      workspaceId: u.workspaceId,
      actorId: u.userId,
      actorRole: 'editor',
    });
    const rows = await db.select().from(schema.comments).where(eq(schema.comments.id, c.id));
    expect(rows).toHaveLength(0);
  });

  it('rejects a non-author editor', async () => {
    const author = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const p = await createPage(db, { workspaceId: author.workspaceId, createdBy: author.userId });
    const { comment: c } = await createComment(db, {
      workspaceId: author.workspaceId,
      pageId: p.id,
      authorId: author.userId,
      body: 'x',
    });
    const otherId = await addUser(author.workspaceId, 'other@x.com');
    await expect(
      deleteComment(db, {
        commentId: c.id,
        workspaceId: author.workspaceId,
        actorId: otherId,
        actorRole: 'editor',
      }),
    ).rejects.toThrow();
    const rows = await db.select().from(schema.comments).where(eq(schema.comments.id, c.id));
    expect(rows).toHaveLength(1);
  });

  it('lets an admin delete someone else’s comment', async () => {
    const author = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const p = await createPage(db, { workspaceId: author.workspaceId, createdBy: author.userId });
    const { comment: c } = await createComment(db, {
      workspaceId: author.workspaceId,
      pageId: p.id,
      authorId: author.userId,
      body: 'x',
    });
    const adminId = await addUser(author.workspaceId, 'admin@x.com');
    await deleteComment(db, {
      commentId: c.id,
      workspaceId: author.workspaceId,
      actorId: adminId,
      actorRole: 'admin',
    });
    const rows = await db.select().from(schema.comments).where(eq(schema.comments.id, c.id));
    expect(rows).toHaveLength(0);
  });

  it('throws for a comment in another workspace', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const other = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: other.workspaceId, createdBy: other.userId });
    const { comment: c } = await createComment(db, {
      workspaceId: other.workspaceId,
      pageId: p.id,
      authorId: other.userId,
      body: 'x',
    });
    await expect(
      deleteComment(db, {
        commentId: c.id,
        workspaceId: u.workspaceId,
        actorId: u.userId,
        actorRole: 'owner',
      }),
    ).rejects.toThrow();
  });
});
