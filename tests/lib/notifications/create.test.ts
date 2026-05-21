import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { notifyCommentReply, notifyMentions } from '@/lib/notifications/create';
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
  await sql`TRUNCATE notifications, comments, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeUser(
  db: ReturnType<typeof drizzle<typeof schema>>,
  label: string,
): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `${label}-${crypto.randomUUID()}@example.com`,
      passwordHash: 'h',
      name: label,
    })
    .returning();
  if (!u) throw new Error('failed to create user');
  return u.id;
}

async function makePage(
  db: ReturnType<typeof drizzle<typeof schema>>,
  workspaceId: string,
  createdBy: string,
): Promise<string> {
  const [p] = await db.insert(schema.pages).values({ workspaceId, createdBy }).returning();
  if (!p) throw new Error('failed to create page');
  return p.id;
}

async function makeComment(
  db: ReturnType<typeof drizzle<typeof schema>>,
  workspaceId: string,
  pageId: string,
  authorId: string,
): Promise<string> {
  const [c] = await db
    .insert(schema.comments)
    .values({ workspaceId, pageId, authorId, body: 'x' })
    .returning();
  if (!c) throw new Error('failed to create comment');
  return c.id;
}

describe('notifyMentions', () => {
  it('writes one mention row per mentioned user with the expected payload', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const pageId = await makePage(db, actor.workspaceId, actor.userId);
    const commentId = await makeComment(db, actor.workspaceId, pageId, actor.userId);
    const b = await makeUser(db, 'b');
    const c = await makeUser(db, 'c');

    const rows = await notifyMentions(db, {
      actorId: actor.userId,
      pageId,
      commentId,
      workspaceId: actor.workspaceId,
      mentionedUserIds: [b, c],
    });

    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.type).toBe('mention');
      expect(r.payload).toEqual({ pageId, commentId, actorId: actor.userId });
      expect(r.readAt).toBeNull();
      expect(r.workspaceId).toBe(actor.workspaceId);
    }
    expect(rows.map((r) => r.userId).sort()).toEqual([b, c].sort());
  });

  it('skips the actor (no self-notification)', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const pageId = await makePage(db, actor.workspaceId, actor.userId);
    const commentId = await makeComment(db, actor.workspaceId, pageId, actor.userId);
    const b = await makeUser(db, 'b');

    const rows = await notifyMentions(db, {
      actorId: actor.userId,
      pageId,
      commentId,
      workspaceId: actor.workspaceId,
      mentionedUserIds: [actor.userId, b],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(b);
  });

  it('dedupes duplicate mentioned ids', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const pageId = await makePage(db, actor.workspaceId, actor.userId);
    const commentId = await makeComment(db, actor.workspaceId, pageId, actor.userId);
    const b = await makeUser(db, 'b');

    const rows = await notifyMentions(db, {
      actorId: actor.userId,
      pageId,
      commentId,
      workspaceId: actor.workspaceId,
      mentionedUserIds: [b, b, b],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(b);
  });

  it('writes nothing for empty or undefined mentionedUserIds', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const pageId = await makePage(db, actor.workspaceId, actor.userId);
    const commentId = await makeComment(db, actor.workspaceId, pageId, actor.userId);

    const empty = await notifyMentions(db, {
      actorId: actor.userId,
      pageId,
      commentId,
      workspaceId: actor.workspaceId,
      mentionedUserIds: [],
    });
    const undef = await notifyMentions(db, {
      actorId: actor.userId,
      pageId,
      commentId,
      workspaceId: actor.workspaceId,
      mentionedUserIds: undefined,
    });

    expect(empty).toEqual([]);
    expect(undef).toEqual([]);
    const all = await db.select().from(schema.notifications);
    expect(all).toHaveLength(0);
  });
});

describe('notifyCommentReply', () => {
  it('notifies prior distinct comment authors except the actor', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const pageId = await makePage(db, actor.workspaceId, actor.userId);
    const c = await makeUser(db, 'c');
    const d = await makeUser(db, 'd');
    // prior comments by c and d
    await makeComment(db, actor.workspaceId, pageId, c);
    await makeComment(db, actor.workspaceId, pageId, d);
    // actor's new comment
    const commentId = await makeComment(db, actor.workspaceId, pageId, actor.userId);

    const rows = await notifyCommentReply(db, {
      actorId: actor.userId,
      pageId,
      commentId,
      workspaceId: actor.workspaceId,
    });

    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.type).toBe('comment_reply');
      expect(r.payload).toEqual({ pageId, commentId, actorId: actor.userId });
      expect(r.readAt).toBeNull();
      expect(r.workspaceId).toBe(actor.workspaceId);
    }
    expect(rows.map((r) => r.userId).sort()).toEqual([c, d].sort());
  });

  it('skips the actor even if they authored earlier comments', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const pageId = await makePage(db, actor.workspaceId, actor.userId);
    const c = await makeUser(db, 'c');
    await makeComment(db, actor.workspaceId, pageId, actor.userId); // actor's prior comment
    await makeComment(db, actor.workspaceId, pageId, c);
    const commentId = await makeComment(db, actor.workspaceId, pageId, actor.userId);

    const rows = await notifyCommentReply(db, {
      actorId: actor.userId,
      pageId,
      commentId,
      workspaceId: actor.workspaceId,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(c);
  });

  it('dedupes: a user with multiple prior comments gets one notification', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const pageId = await makePage(db, actor.workspaceId, actor.userId);
    const c = await makeUser(db, 'c');
    await makeComment(db, actor.workspaceId, pageId, c);
    await makeComment(db, actor.workspaceId, pageId, c);
    await makeComment(db, actor.workspaceId, pageId, c);
    const commentId = await makeComment(db, actor.workspaceId, pageId, actor.userId);

    const rows = await notifyCommentReply(db, {
      actorId: actor.userId,
      pageId,
      commentId,
      workspaceId: actor.workspaceId,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(c);
  });

  it('writes nothing when the actor is the only/first commenter', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const pageId = await makePage(db, actor.workspaceId, actor.userId);
    const commentId = await makeComment(db, actor.workspaceId, pageId, actor.userId);

    const rows = await notifyCommentReply(db, {
      actorId: actor.userId,
      pageId,
      commentId,
      workspaceId: actor.workspaceId,
    });

    expect(rows).toEqual([]);
    const all = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.type, 'comment_reply'));
    expect(all).toHaveLength(0);
  });
});
