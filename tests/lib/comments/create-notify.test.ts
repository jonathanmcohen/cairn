import { and, eq } from 'drizzle-orm';
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
  await sql`TRUNCATE notifications, comments, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeUser(label: string): Promise<string> {
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

function notifs(type: schema.NotificationType) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.type, type));
}

describe('createComment notification triggers', () => {
  it('creates a mention notification for the mentioned user (not the actor)', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: actor.workspaceId, createdBy: actor.userId });
    const b = await makeUser('b');

    const { comment } = await createComment(db, {
      workspaceId: actor.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: actor.userId,
      body: `hi @[B](${b})`,
    });

    const mentions = await notifs('mention');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.userId).toBe(b);
    expect(mentions[0]?.payload).toEqual({
      pageId: p.id,
      commentId: comment.id,
      actorId: actor.userId,
    });
  });

  it('creates a comment_reply notification for a prior author (C != actor)', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: actor.workspaceId, createdBy: actor.userId });
    const c = await makeUser('c');
    await db
      .insert(schema.comments)
      .values({ workspaceId: actor.workspaceId, pageId: p.id, authorId: c, body: 'first' });

    const { comment } = await createComment(db, {
      workspaceId: actor.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: actor.userId,
      body: 'reply',
    });

    const replies = await notifs('comment_reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.userId).toBe(c);
    expect(replies[0]?.payload).toEqual({
      pageId: p.id,
      commentId: comment.id,
      actorId: actor.userId,
    });
    expect(await notifs('mention')).toHaveLength(0);
  });

  it('produces one mention (B) + one comment_reply (C) together', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: actor.workspaceId, createdBy: actor.userId });
    const b = await makeUser('b');
    const c = await makeUser('c');
    await db
      .insert(schema.comments)
      .values({ workspaceId: actor.workspaceId, pageId: p.id, authorId: c, body: 'first' });

    await createComment(db, {
      workspaceId: actor.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: actor.userId,
      body: `hey @[B](${b})`,
    });

    const mentions = await notifs('mention');
    const replies = await notifs('comment_reply');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.userId).toBe(b);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.userId).toBe(c);
  });

  it('produces zero notifications for the first comment by the actor with no mentions', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: actor.workspaceId, createdBy: actor.userId });

    await createComment(db, {
      workspaceId: actor.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: actor.userId,
      body: 'first comment',
    });

    const all = await db.select().from(schema.notifications);
    expect(all).toHaveLength(0);
  });

  it('produces zero notifications for self-mention + self-reply', async () => {
    const actor = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: actor.workspaceId, createdBy: actor.userId });
    // actor's own prior comment
    await db.insert(schema.comments).values({
      workspaceId: actor.workspaceId,
      pageId: p.id,
      authorId: actor.userId,
      body: 'mine',
    });

    await createComment(db, {
      workspaceId: actor.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: actor.userId,
      body: `talking to myself @[Me](${actor.userId})`,
    });

    const all = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.workspaceId, actor.workspaceId)));
    expect(all).toHaveLength(0);
  });
});
