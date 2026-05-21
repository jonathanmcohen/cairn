import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';

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

async function makeUser() {
  const [u] = await getDb()
    .insert(schema.users)
    .values({
      email: `u-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name: 'U',
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
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

describe('POST /api/workspaces', () => {
  it('authed user creates a workspace and becomes owner', async () => {
    cookieSets.length = 0;
    const userId = await makeUser();
    await setUser({ userId });
    const r = await call({ name: 'Side Project' });
    expect(r.status).toBe(201);
    const ws = r.body as { id: string; name: string };
    expect(ws.name).toBe('Side Project');

    const members = await getDb()
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, ws.id));
    expect(members[0]?.userId).toBe(userId);
    expect(members[0]?.role).toBe('owner');
    expect(cookieSets).toContainEqual({ name: 'cairn_ws', value: ws.id });
  });

  it('unauthenticated is 401', async () => {
    await setUser(null);
    const r = await call({ name: 'Nope' });
    expect(r.status).toBe(401);
  });

  it('rejects an empty name with 400', async () => {
    await setUser({ userId: await makeUser() });
    const r = await call({ name: '' });
    expect(r.status).toBe(400);
  });
});
