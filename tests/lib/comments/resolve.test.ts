import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
import { reopenComment, resolveComment } from '@/lib/comments/resolve';
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

describe('resolveComment / reopenComment', () => {
  it('resolves then reopens', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const c = await createComment(db, {
      workspaceId: u.workspaceId,
      pageId: p.id,
      authorId: u.userId,
      body: 'x',
    });

    const resolved = await resolveComment(db, { commentId: c.id, workspaceId: u.workspaceId });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);

    const reopened = await reopenComment(db, { commentId: c.id, workspaceId: u.workspaceId });
    expect(reopened.resolvedAt).toBeNull();
  });

  it('throws for a comment in another workspace', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const c = await createComment(db, {
      workspaceId: u.workspaceId,
      pageId: p.id,
      authorId: u.userId,
      body: 'x',
    });
    await expect(
      resolveComment(db, { commentId: c.id, workspaceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    ).rejects.toThrow();
  });
});
