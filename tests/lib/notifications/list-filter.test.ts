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

describe('listNotifications — filter clauses (P16)', () => {
  it('filter.type narrows to the given types (inArray); [] is treated as "no clause"', async () => {
    const me = await createTestWorkspaceWithUser(db);
    await seedNotification({ userId: me.userId, workspaceId: me.workspaceId, type: 'mention' });
    await seedNotification({ userId: me.userId, workspaceId: me.workspaceId, type: 'mention' });
    await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      type: 'comment_reply',
    });

    const justMentions = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: { type: ['mention'] },
    });
    expect(justMentions.notifications).toHaveLength(2);
    expect(justMentions.notifications.every((n) => n.type === 'mention')).toBe(true);

    const both = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: { type: ['mention', 'comment_reply'] },
    });
    expect(both.notifications).toHaveLength(3);

    const empty = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: { type: [] },
    });
    expect(empty.notifications).toHaveLength(3);
  });

  it('filter.status: read / unread / all', async () => {
    const me = await createTestWorkspaceWithUser(db);
    await seedNotification({ userId: me.userId, workspaceId: me.workspaceId, readAt: null });
    await seedNotification({ userId: me.userId, workspaceId: me.workspaceId, readAt: null });
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
    expect(unread.notifications).toHaveLength(2);
    expect(unread.notifications.every((n) => n.readAt == null)).toBe(true);

    const read = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: { status: 'read' },
    });
    expect(read.notifications).toHaveLength(1);
    expect(read.notifications[0]?.readAt).not.toBeNull();

    const all = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: { status: 'all' },
    });
    expect(all.notifications).toHaveLength(3);

    // omitted status === all
    const omitted = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: {},
    });
    expect(omitted.notifications).toHaveLength(3);
  });

  it('filter.dateFrom (inclusive) + dateTo (exclusive) bound created_at', async () => {
    const me = await createTestWorkspaceWithUser(db);
    await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      createdAt: new Date('2026-05-10T00:00:00Z'),
    });
    await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      createdAt: new Date('2026-05-15T00:00:00Z'),
    });
    await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      createdAt: new Date('2026-05-20T00:00:00Z'),
    });

    // [2026-05-15, 2026-05-20) — inclusive from, exclusive to
    const result = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: {
        dateFrom: new Date('2026-05-15T00:00:00Z'),
        dateTo: new Date('2026-05-20T00:00:00Z'),
      },
    });
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]?.createdAt).toEqual(new Date('2026-05-15T00:00:00Z'));
  });

  it('combinations compose: type + status + date range + keyset cursor', async () => {
    const me = await createTestWorkspaceWithUser(db);
    // 6 mentions in date order, all unread.
    const dates = [
      '2026-05-10',
      '2026-05-11',
      '2026-05-12',
      '2026-05-13',
      '2026-05-14',
      '2026-05-15',
    ].map((d) => new Date(`${d}T00:00:00Z`));
    for (const createdAt of dates) {
      await seedNotification({
        userId: me.userId,
        workspaceId: me.workspaceId,
        type: 'mention',
        createdAt,
      });
    }
    // 1 mention READ inside the window — must NOT appear with status: unread.
    await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      type: 'mention',
      createdAt: new Date('2026-05-13T12:00:00Z'),
      readAt: new Date(),
    });
    // 1 comment_reply unread inside the window — must NOT appear with type: ['mention'].
    await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      type: 'comment_reply',
      createdAt: new Date('2026-05-13T08:00:00Z'),
    });

    // Window [2026-05-11, 2026-05-15) + type=mention + status=unread → expect 4 rows
    // (11, 12, 13, 14 — and only mentions, only unread).
    const baseFilter = {
      type: ['mention'] as const,
      status: 'unread' as const,
      dateFrom: new Date('2026-05-11T00:00:00Z'),
      dateTo: new Date('2026-05-15T00:00:00Z'),
    };
    const page1 = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: { ...baseFilter, type: [...baseFilter.type] },
      limit: 2,
    });
    expect(page1.notifications).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listNotifications(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
      filter: { ...baseFilter, type: [...baseFilter.type] },
      limit: 2,
      cursor: page1.nextCursor,
    });
    // With limit=2 and exactly 4 matching rows, page2 finishes the set —
    // hasMore=false, so the helper returns nextCursor=null.
    expect(page2.notifications).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const all = [...page1.notifications, ...page2.notifications];
    expect(all).toHaveLength(4);
    expect(new Set(all.map((n) => n.id)).size).toBe(4);
    expect(all.every((n) => n.type === 'mention' && n.readAt == null)).toBe(true);
    // Newest-first across the page boundary: 14, 13, 12, 11.
    expect(all.map((n) => n.createdAt.toISOString())).toEqual([
      '2026-05-14T00:00:00.000Z',
      '2026-05-13T00:00:00.000Z',
      '2026-05-12T00:00:00.000Z',
      '2026-05-11T00:00:00.000Z',
    ]);
  });
});
