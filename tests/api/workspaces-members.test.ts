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

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

// Add a member (new user + membership) to an existing workspace.
async function addMember(workspaceId: string, name: string, email: string) {
  const db = getDb();
  const [u] = await db.insert(schema.users).values({ email, passwordHash: 'h', name }).returning();
  if (!u) throw new Error('user insert failed');
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: u.id, role: 'editor' });
  return u;
}

async function call(query: string) {
  const { GET } = await import('@/app/api/workspaces/members/route');
  const res = await GET(
    new Request(`http://localhost/api/workspaces/members?q=${encodeURIComponent(query)}`),
  );
  return {
    status: res.status,
    body: (await res.json()) as { members?: { id: string; name: string; email: string }[] },
  };
}

describe('GET /api/workspaces/members', () => {
  it('viewer can search members of their workspace', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    await addMember(u.workspaceId, 'Ada Lovelace', 'ada@x.com');
    await setUser(u.userId);
    const r = await call('ada');
    expect(r.status).toBe(200);
    expect(r.body.members?.map((m) => m.name)).toContain('Ada Lovelace');
  });

  it('matches on email substring (ILIKE)', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    await addMember(u.workspaceId, 'Grace Hopper', 'grace@navy.mil');
    await setUser(u.userId);
    const r = await call('navy');
    expect(r.body.members?.map((m) => m.email)).toContain('grace@navy.mil');
  });

  it('does not return members of other workspaces', async () => {
    const mine = await createTestWorkspaceWithUser(getDb());
    const other = await createTestWorkspaceWithUser(getDb());
    await addMember(other.workspaceId, 'Stranger Danger', 'stranger@x.com');
    await setUser(mine.userId);
    const r = await call('stranger');
    expect(r.body.members ?? []).toHaveLength(0);
  });

  it('empty query returns workspace members (for the bare @ menu)', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    await addMember(u.workspaceId, 'Someone Here', 'here@x.com');
    await setUser(u.userId);
    const r = await call('');
    expect(r.status).toBe(200);
    expect((r.body.members ?? []).length).toBeGreaterThan(0);
  });

  it('unauthenticated is 401', async () => {
    await setUser(null);
    const r = await call('ada');
    expect(r.status).toBe(401);
  });
});
