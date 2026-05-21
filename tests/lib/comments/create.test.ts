import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
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

describe('createComment', () => {
  it('creates a page-level comment and surfaces mentioned userIds', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const [mentionedUser] = await db
      .insert(schema.users)
      .values({
        email: `alice-${crypto.randomUUID()}@example.com`,
        passwordHash: 'h',
        name: 'Alice',
      })
      .returning();
    if (!mentionedUser) throw new Error('failed to create mentioned user');
    const mentioned = mentionedUser.id;
    const { comment: c, mentionedUserIds } = await createComment(db, {
      workspaceId: u.workspaceId,
      pageId: p.id,
      authorId: u.userId,
      body: `hello @[Alice](${mentioned})`,
    });
    expect(c.anchor).toBeNull();
    expect(c.body).toBe(`hello @[Alice](${mentioned})`);
    expect(c.resolvedAt).toBeNull();
    // Plan 6 seam: createComment returns the parsed mention ids (no notifications here).
    expect(mentionedUserIds).toEqual([mentioned]);
  });

  it('creates a block-anchored comment', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment: c } = await createComment(db, {
      workspaceId: u.workspaceId,
      pageId: p.id,
      authorId: u.userId,
      body: 'anchored',
      anchor: { blockId: 'blk-7' },
    });
    expect(c.anchor).toEqual({ blockId: 'blk-7' });
  });

  it('creates a range-anchored comment', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment: c } = await createComment(db, {
      workspaceId: u.workspaceId,
      pageId: p.id,
      authorId: u.userId,
      body: 'ranged',
      anchor: { from: 2, to: 5 },
    });
    expect(c.anchor).toEqual({ from: 2, to: 5 });
  });

  it('rejects a page in another workspace', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const other = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: other.workspaceId, createdBy: other.userId });
    await expect(
      createComment(db, {
        workspaceId: u.workspaceId,
        pageId: p.id,
        authorId: u.userId,
        body: 'x',
      }),
    ).rejects.toThrow();
  });

  it('rejects a malformed anchor', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await expect(
      createComment(db, {
        workspaceId: u.workspaceId,
        pageId: p.id,
        authorId: u.userId,
        body: 'x',
        anchor: { blockId: 'b', from: 1 } as never,
      }),
    ).rejects.toThrow();
  });
});
