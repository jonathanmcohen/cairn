import { and, eq, isNull } from 'drizzle-orm';
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

async function call() {
  const { POST } = await import('@/app/api/notifications/mark-all-read/route');
  const res = await POST(
    new Request('http://localhost/api/notifications/mark-all-read', { method: 'POST' }),
  );
  return { status: res.status, body: await res.json() };
}

describe('POST /api/notifications/mark-all-read', () => {
  it('401 unauthenticated', async () => {
    await setUser(null);
    const r = await call();
    expect(r.status).toBe(401);
  });

  it('flips every unread row for (userId, workspaceId) and returns the count', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    for (let i = 0; i < 4; i++) await seed(me.userId, me.workspaceId);
    await setUser(me.userId);

    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ affected: 4 });

    const unread = await getDb()
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, me.userId),
          eq(schema.notifications.workspaceId, me.workspaceId),
          isNull(schema.notifications.readAt),
        ),
      );
    expect(unread).toHaveLength(0);
  });

  it('does NOT mark cross-workspace rows read', async () => {
    const a = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const b = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    // Same user, different workspace — must NOT be flipped when `a` is active.
    const cross = await seed(a.userId, b.workspaceId);
    await seed(a.userId, a.workspaceId);
    await setUser(a.userId);

    const r = await call();
    expect(r.status).toBe(200);
    expect((r.body as { affected: number }).affected).toBe(1);

    const [stillUnread] = await getDb()
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, cross.id));
    expect(stillUnread?.readAt).toBeNull();
  });
});
