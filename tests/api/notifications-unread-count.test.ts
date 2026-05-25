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

async function seed(input: { userId: string; workspaceId: string; read?: boolean }) {
  const [row] = await getDb()
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      type: 'mention',
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

async function call() {
  const { GET } = await import('@/app/api/notifications/unread-count/route');
  const res = await GET(new Request('http://localhost/api/notifications/unread-count'));
  return { status: res.status, body: await res.json() };
}

describe('GET /api/notifications/unread-count', () => {
  it('401 unauthenticated', async () => {
    await setUser(null);
    const r = await call();
    expect(r.status).toBe(401);
  });

  it('returns unread count scoped to (userId, workspaceId)', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await seed({ userId: me.userId, workspaceId: me.workspaceId });
    await seed({ userId: me.userId, workspaceId: me.workspaceId });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, read: true });
    await setUser(me.userId);

    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ unreadCount: 2 });
  });

  it('isolates other workspaces (cross-workspace unread NOT counted)', async () => {
    const a = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const b = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await seed({ userId: a.userId, workspaceId: a.workspaceId });
    // Same user, different workspace — must not be counted while `a.workspaceId`
    // is the active workspace.
    await seed({ userId: a.userId, workspaceId: b.workspaceId });
    await setUser(a.userId);

    const r = await call();
    expect(r.status).toBe(200);
    expect((r.body as { unreadCount: number }).unreadCount).toBe(1);
  });

  it('returns 0 when the caller has no unread notifications', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await seed({ userId: me.userId, workspaceId: me.workspaceId, read: true });
    await setUser(me.userId);
    const r = await call();
    expect(r.status).toBe(200);
    expect((r.body as { unreadCount: number }).unreadCount).toBe(0);
  });
});
