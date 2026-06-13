import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { captureInbox } from '@/lib/inbox/capture';
import { markInboxDone } from '@/lib/inbox/triage';
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
  await sql`TRUNCATE pages, audit_log, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function call() {
  const { GET } = await import('@/app/api/inbox/count/route');
  const res = await GET(new Request('http://localhost/api/inbox/count'));
  return { status: res.status, body: await res.json() };
}

async function capture(u: { userId: string; workspaceId: string }, title: string) {
  return captureInbox(getDb(), {
    workspaceId: u.workspaceId,
    userId: u.userId,
    payload: { title, body: '', url: null },
  });
}

describe('GET /api/inbox/count', () => {
  it('401 unauthenticated', async () => {
    await setUser(null);
    const r = await call();
    expect(r.status).toBe(401);
  });

  it('returns 0 when the workspace has never captured (no inbox page)', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(me.userId);
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ count: 0 });
  });

  it('returns the untriaged-capture count for the active workspace', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await capture(me, 'a');
    await capture(me, 'b');
    const done = await capture(me, 'c');
    await markInboxDone(getDb(), {
      pageId: done.capturedPageId,
      workspaceId: me.workspaceId,
      userId: me.userId,
    });
    await setUser(me.userId);

    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ count: 2 });
  });

  it('isolates other workspaces (cross-workspace captures NOT counted)', async () => {
    const a = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const b = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await capture(a, 'mine');
    await capture(b, 'theirs-1');
    await capture(b, 'theirs-2');
    await setUser(a.userId);

    const r = await call();
    expect(r.status).toBe(200);
    expect((r.body as { count: number }).count).toBe(1);
  });
});
