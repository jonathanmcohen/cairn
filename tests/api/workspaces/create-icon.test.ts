import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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
    set: () => {},
  }),
}));

async function setUser(c: { userId: string } | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}

async function call(body: unknown): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('@/app/api/workspaces/route');
  const res = await POST(
    new Request('http://localhost/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe('POST /api/workspaces icon', () => {
  it('creates a workspace with the supplied icon (201)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser({ userId: u.userId });
    const r = await call({ name: 'Acme', icon: 'emoji::🪨' });
    expect(r.status).toBe(201);
    expect((r.body as { icon: string | null }).icon).toBe('emoji::🪨');
  });

  it('rejects an empty name (400)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser({ userId: u.userId });
    const r = await call({ name: '' });
    expect(r.status).toBe(400);
  });

  it('defaults icon to null when omitted (201)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser({ userId: u.userId });
    const r = await call({ name: 'NoIcon' });
    expect(r.status).toBe(201);
    expect((r.body as { icon: string | null }).icon).toBeNull();
  });
});
