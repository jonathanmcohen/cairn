import { runMigrations } from '@/db/migrate';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';

let uri = '';
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  uri = await startPostgres();
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
  await sql`TRUNCATE workspaces, users, workspace_members, invite_tokens, sessions, accounts RESTART IDENTITY CASCADE`;
});

type MockSession = { userId: string; role: 'owner' | 'admin' | 'editor' | 'viewer' } | null;

vi.mock('@/lib/auth/config', () => {
  let mockedCtx: MockSession = null;
  return {
    auth: async () => (mockedCtx ? { user: { id: mockedCtx.userId } } : null),
    __setSession: (ctx: MockSession) => {
      mockedCtx = ctx;
    },
  };
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const { getDb } = await import('@/db/client');
  const db = getDb();
  const schema = await import('@/db/schema');
  const [ws] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!ws) throw new Error('failed to create ws');
  const [u] = await db
    .insert(schema.users)
    .values({ email: `${role}@x.com`, passwordHash: 'h', name: role })
    .returning();
  if (!u) throw new Error('failed to create user');
  await db.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __setSession: (ctx: MockSession) => void;
  };
  mod.__setSession({ userId: u.id, role });
  return { workspaceId: ws.id, userId: u.id };
}

async function call(body: unknown): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('@/app/api/invites/route');
  const res = await POST(
    new Request('http://localhost/api/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe('POST /api/invites', () => {
  it('admin can create an invite', async () => {
    await asUser('admin');
    const r = await call({ email: 'new@x.com', role: 'editor' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ email: 'new@x.com', role: 'editor' });
  });

  it('editor cannot create an invite', async () => {
    await asUser('editor');
    const r = await call({ email: 'new@x.com', role: 'editor' });
    expect(r.status).toBe(403);
  });

  it('unauthenticated returns 401', async () => {
    const mod = (await import('@/lib/auth/config')) as unknown as {
      __setSession: (ctx: MockSession) => void;
    };
    mod.__setSession(null);
    const r = await call({ email: 'new@x.com', role: 'editor' });
    expect(r.status).toBe(401);
  });

  it('owner cannot be assigned via invite (rejected with 400)', async () => {
    await asUser('owner');
    const r = await call({ email: 'new@x.com', role: 'owner' });
    expect(r.status).toBe(400);
  });
});
