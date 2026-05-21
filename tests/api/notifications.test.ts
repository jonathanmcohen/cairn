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
}) {
  const [row] = await getDb()
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      type: input.type ?? 'mention',
      payload: {
        pageId: '11111111-1111-1111-1111-111111111111',
        commentId: '22222222-2222-2222-2222-222222222222',
        actorId: '33333333-3333-3333-3333-333333333333',
      },
      readAt: input.read ? new Date() : null,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row;
}

async function getFeed(query = '') {
  const { GET } = await import('@/app/api/notifications/route');
  const res = await GET(new Request(`http://localhost/api/notifications${query}`));
  return { status: res.status, body: await res.json() };
}

async function postRead(body: unknown) {
  const { POST } = await import('@/app/api/notifications/read/route');
  const res = await POST(
    new Request('http://localhost/api/notifications/read', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe('GET /api/notifications', () => {
  it('unauthenticated is 401', async () => {
    await setUser(null);
    const r = await getFeed();
    expect(r.status).toBe(401);
  });

  it('returns only the caller’s notifications in the active workspace', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    // Mine, active workspace — should appear.
    await seed({ userId: me.userId, workspaceId: me.workspaceId });
    await seed({ userId: me.userId, workspaceId: me.workspaceId });
    // Mine, but a DIFFERENT workspace — must not leak.
    await seed({ userId: me.userId, workspaceId: other.workspaceId });
    // Another user's notification in my workspace — must not leak.
    await seed({ userId: other.userId, workspaceId: me.workspaceId });

    await setUser(me.userId);
    const r = await getFeed();
    expect(r.status).toBe(200);
    const body = r.body as {
      notifications: { id: string; userId: string; workspaceId: string }[];
      unreadCount: number;
    };
    expect(body.notifications).toHaveLength(2);
    for (const n of body.notifications) {
      expect(n.userId).toBe(me.userId);
      expect(n.workspaceId).toBe(me.workspaceId);
    }
    expect(body.unreadCount).toBe(2);
  });

  it('orders newest-first and respects limit', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const a = await seed({ userId: me.userId, workspaceId: me.workspaceId });
    await new Promise((res) => setTimeout(res, 5));
    const b = await seed({ userId: me.userId, workspaceId: me.workspaceId });

    await setUser(me.userId);
    const r = await getFeed('?limit=1');
    expect(r.status).toBe(200);
    const body = r.body as { notifications: { id: string }[] };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]?.id).toBe(b.id);
    expect(body.notifications[0]?.id).not.toBe(a.id);
  });

  it('unreadOnly filters out read rows', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, read: false });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, read: true });

    await setUser(me.userId);
    const r = await getFeed('?unreadOnly=true');
    expect(r.status).toBe(200);
    const body = r.body as {
      notifications: { readAt: string | null }[];
      unreadCount: number;
    };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]?.readAt).toBeNull();
    expect(body.unreadCount).toBe(1);
  });
});

describe('POST /api/notifications/read', () => {
  it('unauthenticated is 401', async () => {
    await setUser(null);
    const r = await postRead({ all: true });
    expect(r.status).toBe(401);
  });

  it('marks a single row read by id', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const row = await seed({ userId: me.userId, workspaceId: me.workspaceId });

    await setUser(me.userId);
    const r = await postRead({ id: row.id });
    expect(r.status).toBe(200);
    expect((r.body as { updated: number }).updated).toBe(1);

    const feed = await getFeed('?unreadOnly=true');
    expect((feed.body as { unreadCount: number }).unreadCount).toBe(0);
  });

  it('cannot mark another user’s notification (no-op)', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const theirs = await seed({ userId: other.userId, workspaceId: other.workspaceId });

    await setUser(me.userId);
    const r = await postRead({ id: theirs.id });
    expect(r.status).toBe(200);
    expect((r.body as { updated: number }).updated).toBe(0);

    const [still] = await sql`SELECT read_at FROM notifications WHERE id = ${theirs.id}`;
    expect(still?.read_at).toBeNull();
  });

  it('marks all the caller’s unread rows read', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    await seed({ userId: me.userId, workspaceId: me.workspaceId });
    await seed({ userId: me.userId, workspaceId: me.workspaceId });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, read: true });

    await setUser(me.userId);
    const r = await postRead({ all: true });
    expect(r.status).toBe(200);
    expect((r.body as { updated: number }).updated).toBe(2);

    const feed = await getFeed('?unreadOnly=true');
    expect((feed.body as { notifications: unknown[] }).notifications).toHaveLength(0);
  });
});
