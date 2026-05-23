import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
import { deleteComment } from '@/lib/comments/delete';
import { reopenComment, resolveComment } from '@/lib/comments/resolve';
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

async function fileComment(workspaceId: string, userId: string) {
  const [f] = await db
    .insert(schema.files)
    .values({ workspaceId, name: 'a', mimeType: 't', size: 1, path: '/p', uploadedBy: userId })
    .returning();
  if (!f) throw new Error('file');
  const { comment } = await createComment(db, {
    workspaceId,
    authorId: userId,
    body: 'on file',
    target: { type: 'file', id: f.id },
  });
  return comment;
}

describe('resolve/delete on non-page targets', () => {
  it('resolves then reopens a file comment', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const c = await fileComment(u.workspaceId, u.userId);
    const resolved = await resolveComment(db, { commentId: c.id, workspaceId: u.workspaceId });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    const reopened = await reopenComment(db, { commentId: c.id, workspaceId: u.workspaceId });
    expect(reopened.resolvedAt).toBeNull();
  });

  it('lets the author delete a file comment', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const c = await fileComment(u.workspaceId, u.userId);
    await deleteComment(db, {
      commentId: c.id,
      workspaceId: u.workspaceId,
      actorId: u.userId,
      actorRole: 'editor',
    });
    const rows = await db.select().from(schema.comments).where(eq(schema.comments.id, c.id));
    expect(rows).toHaveLength(0);
  });

  it('404s deleting a file comment from another workspace', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const other = await createTestWorkspaceWithUser(db);
    const c = await fileComment(other.workspaceId, other.userId);
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
