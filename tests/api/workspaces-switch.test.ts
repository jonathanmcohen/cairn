import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

const cookieSets: { name: string; value: string }[] = [];
vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string) => {
      cookieSets.push({ name, value });
    },
  }),
}));

async function setUser(c: { userId: string } | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}

async function call(body: unknown): Promise<{ status: number }> {
  const { POST } = await import('@/app/api/workspaces/switch/route');
  const res = await POST(
    new Request('http://localhost/api/workspaces/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status };
}

describe('POST /api/workspaces/switch', () => {
  it('member switches and the cookie is set', async () => {
    cookieSets.length = 0;
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser({ userId: u.userId });
    const r = await call({ workspaceId: u.workspaceId });
    expect(r.status).toBe(200);
    expect(cookieSets).toContainEqual({ name: 'cairn_ws', value: u.workspaceId });
  });

  it('non-member is 403', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser({ userId: u.userId });
    const r = await call({ workspaceId: other.workspaceId });
    expect(r.status).toBe(403);
  });

  it('unauthenticated is 401', async () => {
    await setUser(null);
    const r = await call({ workspaceId: '00000000-0000-0000-0000-000000000000' });
    expect(r.status).toBe(401);
  });

  it('invalid body is 400', async () => {
    await setUser({ userId: (await createTestWorkspaceWithUser(getDb())).userId });
    const r = await call({ workspaceId: 'not-a-uuid' });
    expect(r.status).toBe(400);
  });
});
