import { eq } from 'drizzle-orm';
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

async function seed(userId: string, workspaceId: string) {
  const [row] = await getDb()
    .insert(schema.notifications)
    .values({
      userId,
      workspaceId,
      type: 'mention',
      payload: {
        pageId: '11111111-1111-1111-1111-111111111111',
        commentId: '22222222-2222-2222-2222-222222222222',
        actorId: '33333333-3333-3333-3333-333333333333',
      },
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row;
}

async function call(id: string) {
  const { POST } = await import('@/app/api/notifications/[id]/read/route');
  const res = await POST(new Request('http://localhost/x', { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /api/notifications/[id]/read', () => {
  it('401 unauthenticated', async () => {
    await setUser(null);
    const r = await call('00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe(401);
  });

  it("flips readAt for the caller's own notification", async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const n = await seed(me.userId, me.workspaceId);
    await setUser(me.userId);

    const r = await call(n.id);
    expect(r.status).toBe(200);
    const [updated] = await getDb()
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, n.id));
    expect(updated?.readAt).not.toBeNull();
  });

  it('returns 404 (not 403) when the notification belongs to another user', async () => {
    const a = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const b = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const theirs = await seed(a.userId, a.workspaceId);
    await setUser(b.userId);

    const r = await call(theirs.id);
    expect(r.status).toBe(404);
    const [unchanged] = await getDb()
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, theirs.id));
    expect(unchanged?.readAt).toBeNull();
  });

  it('returns 400 on a malformed id', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(me.userId);
    const r = await call('not-a-uuid');
    expect(r.status).toBe(400);
  });
});
