import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listNotifications } from '@/lib/notifications/list';
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

type SeedInput = {
  userId: string;
  workspaceId: string;
  type?: schema.NotificationType;
  readAt?: Date | null;
  createdAt?: Date;
};

async function seedNotification(input: SeedInput): Promise<schema.Notification> {
  const values: typeof schema.notifications.$inferInsert = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    type: input.type ?? 'mention',
    payload: {
      pageId: '11111111-1111-1111-1111-111111111111',
      commentId: '22222222-2222-2222-2222-222222222222',
      actorId: '33333333-3333-3333-3333-333333333333',
    },
    readAt: input.readAt ?? null,
  };
  if (input.createdAt) values.createdAt = input.createdAt;
  const [row] = await db.insert(schema.notifications).values(values).returning();
  if (!row) throw new Error('seed failed');
  return row;
}

describe('listNotifications (keyset cursor over created_at desc, id desc)', () => {
  it('isolates by (userId, workspaceId) — never returns other users or other workspaces', async () => {
    const me = await createTestWorkspaceWithUser(db);
    const other = await createTestWorkspaceWithUser(db);
    await seedNotification({ userId: me.userId, workspaceId: me.workspaceId });
    await seedNotification({ userId: other.userId, workspaceId: me.workspaceId });
    await seedNotification({ userId: me.userId, workspaceId: other.workspaceId });

    const result = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      limit: 50,
    });
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]?.userId).toBe(me.userId);
    expect(result.notifications[0]?.workspaceId).toBe(me.workspaceId);
    expect(result.nextCursor).toBeNull();
  });

  it('returns rows newest-first by created_at desc, id desc', async () => {
    const me = await createTestWorkspaceWithUser(db);
    const a = await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      createdAt: new Date('2026-05-20T00:00:00Z'),
    });
    const b = await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      createdAt: new Date('2026-05-22T00:00:00Z'),
    });
    const c = await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      createdAt: new Date('2026-05-21T00:00:00Z'),
    });
    const result = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      limit: 10,
    });
    expect(result.notifications.map((n) => n.id)).toEqual([b.id, c.id, a.id]);
  });

  it('cursor resumes without overlap or gap', async () => {
    const me = await createTestWorkspaceWithUser(db);
    for (let i = 0; i < 7; i++) {
      await seedNotification({
        userId: me.userId,
        workspaceId: me.workspaceId,
        createdAt: new Date(`2026-05-${String(10 + i).padStart(2, '0')}T00:00:00Z`),
      });
    }
    const page1 = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      limit: 3,
    });
    expect(page1.notifications).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      limit: 3,
      cursor: page1.nextCursor,
    });
    expect(page2.nextCursor).not.toBeNull();
    const page3 = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      limit: 3,
      cursor: page2.nextCursor,
    });
    expect(page3.nextCursor).toBeNull();
    const all = [...page1.notifications, ...page2.notifications, ...page3.notifications];
    expect(all).toHaveLength(7);
    expect(new Set(all.map((n) => n.id)).size).toBe(7);
  });

  it('clamps limit to ≤ 100 and defaults to 50', async () => {
    const me = await createTestWorkspaceWithUser(db);
    for (let i = 0; i < 120; i++) {
      await seedNotification({
        userId: me.userId,
        workspaceId: me.workspaceId,
        createdAt: new Date(2026, 0, 1 + i),
      });
    }
    const huge = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      limit: 9999,
    });
    expect(huge.notifications.length).toBeLessThanOrEqual(100);
    const def = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
    });
    expect(def.notifications).toHaveLength(50);
  });

  it('accepts an optional `filter` argument (P16 extends this)', async () => {
    const me = await createTestWorkspaceWithUser(db);
    await seedNotification({ userId: me.userId, workspaceId: me.workspaceId, type: 'mention' });
    await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      type: 'comment_reply',
    });
    const result = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: undefined,
    });
    expect(result.notifications).toHaveLength(2);
  });

  it('honors filter.status = "unread" (used by GET /api/notifications?unreadOnly=true)', async () => {
    const me = await createTestWorkspaceWithUser(db);
    await seedNotification({ userId: me.userId, workspaceId: me.workspaceId });
    await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      readAt: new Date(),
    });
    const unread = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: { status: 'unread' },
    });
    expect(unread.notifications).toHaveLength(1);
    expect(unread.notifications[0]?.readAt).toBeNull();
  });
});
