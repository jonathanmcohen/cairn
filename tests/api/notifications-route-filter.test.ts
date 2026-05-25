import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE notifications, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function seed(input: {
  userId: string;
  workspaceId: string;
  type?: schema.NotificationType;
  read?: boolean;
  createdAt?: Date;
}) {
  const values: typeof schema.notifications.$inferInsert = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    type: input.type ?? 'mention',
    payload: {
      pageId: '11111111-1111-1111-1111-111111111111',
      commentId: '22222222-2222-2222-2222-222222222222',
      actorId: '33333333-3333-3333-3333-333333333333',
    },
    readAt: input.read ? new Date() : null,
  };
  if (input.createdAt) values.createdAt = input.createdAt;
  const [row] = await getDb().insert(schema.notifications).values(values).returning();
  if (!row) throw new Error('seed failed');
  return row;
}

async function getFeed(query: string) {
  const { GET } = await import('@/app/api/notifications/route');
  const res = await GET(new Request(`http://localhost/api/notifications${query}`));
  return { status: res.status, body: await res.json() };
}

describe('GET /api/notifications — filter query params (P16)', () => {
  it('forwards repeated type[] to the helper', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, type: 'mention' });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, type: 'comment_reply' });
    await setUser(me.userId);

    const r = await getFeed('?type=mention');
    expect(r.status).toBe(200);
    const body = r.body as { notifications: { type: string }[] };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]?.type).toBe('mention');

    // Repeatable: both types pass through.
    const r2 = await getFeed('?type=mention&type=comment_reply');
    expect(r2.status).toBe(200);
    expect((r2.body as { notifications: unknown[] }).notifications).toHaveLength(2);
  });

  it('forwards status=read / unread / all', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await seed({ userId: me.userId, workspaceId: me.workspaceId });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, read: true });
    await setUser(me.userId);

    const unread = await getFeed('?status=unread');
    expect(unread.status).toBe(200);
    expect((unread.body as { notifications: unknown[] }).notifications).toHaveLength(1);

    const read = await getFeed('?status=read');
    expect(read.status).toBe(200);
    expect((read.body as { notifications: unknown[] }).notifications).toHaveLength(1);

    const all = await getFeed('?status=all');
    expect(all.status).toBe(200);
    expect((all.body as { notifications: unknown[] }).notifications).toHaveLength(2);
  });

  it('forwards dateFrom (inclusive) + dateTo (exclusive)', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await seed({
      userId: me.userId,
      workspaceId: me.workspaceId,
      createdAt: new Date('2026-05-10T00:00:00Z'),
    });
    await seed({
      userId: me.userId,
      workspaceId: me.workspaceId,
      createdAt: new Date('2026-05-15T00:00:00Z'),
    });
    await seed({
      userId: me.userId,
      workspaceId: me.workspaceId,
      createdAt: new Date('2026-05-20T00:00:00Z'),
    });
    await setUser(me.userId);

    const r = await getFeed('?dateFrom=2026-05-15T00:00:00Z&dateTo=2026-05-20T00:00:00Z');
    expect(r.status).toBe(200);
    const body = r.body as { notifications: { createdAt: string }[] };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]?.createdAt).toBe('2026-05-15T00:00:00.000Z');
  });

  it('400 on malformed dateFrom', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(me.userId);
    const r = await getFeed('?dateFrom=not-a-date');
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe('validation');
  });

  it('400 on unknown status value', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(me.userId);
    const r = await getFeed('?status=bogus');
    expect(r.status).toBe(400);
  });

  it('back-compat: unreadOnly=true still produces an unread-only feed', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await seed({ userId: me.userId, workspaceId: me.workspaceId });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, read: true });
    await setUser(me.userId);

    const r = await getFeed('?unreadOnly=true');
    expect(r.status).toBe(200);
    expect((r.body as { notifications: unknown[] }).notifications).toHaveLength(1);
  });

  it('status wins when both unreadOnly and status are set (status=all overrides)', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await seed({ userId: me.userId, workspaceId: me.workspaceId });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, read: true });
    await setUser(me.userId);

    const r = await getFeed('?unreadOnly=true&status=all');
    expect(r.status).toBe(200);
    expect((r.body as { notifications: unknown[] }).notifications).toHaveLength(2);
  });
});
