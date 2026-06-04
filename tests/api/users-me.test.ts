import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
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
  await sql`TRUNCATE workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

type MockSession = { userId: string } | null;

vi.mock('@/lib/auth/config', () => {
  let mockedCtx: MockSession = null;
  return {
    auth: async () => (mockedCtx ? { user: { id: mockedCtx.userId } } : null),
    __setSession: (ctx: MockSession) => {
      mockedCtx = ctx;
    },
  };
});

async function setSession(ctx: MockSession) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __setSession: (ctx: MockSession) => void;
  };
  mod.__setSession(ctx);
}

async function asUser() {
  const { getDb } = await import('@/db/client');
  const db = getDb();
  const schema = await import('@/db/schema');
  const [ws] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!ws) throw new Error('failed to create ws');
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'me@x.com', passwordHash: 'h', name: 'Old Name' })
    .returning();
  if (!u) throw new Error('failed to create user');
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: ws.id, userId: u.id, role: 'editor' });
  await setSession({ userId: u.id });
  return { workspaceId: ws.id, userId: u.id };
}

async function patch(body: unknown): Promise<{ status: number; body: unknown }> {
  const { PATCH } = await import('@/app/api/users/me/route');
  const res = await PATCH(
    new Request('http://localhost/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe('PATCH /api/users/me (#198/#199 K4/K5)', () => {
  it('updates the display name for the signed-in user', async () => {
    const u = await asUser();
    const r = await patch({ name: 'Renamed' });
    expect(r.status).toBe(200);
    expect((r.body as { name: string }).name).toBe('Renamed');
    const { getDb } = await import('@/db/client');
    const schema = await import('@/db/schema');
    const [row] = await getDb().select().from(schema.users).where(eq(schema.users.id, u.userId));
    expect(row?.name).toBe('Renamed');
  });

  it('returns 401 when unauthenticated', async () => {
    await setSession(null);
    const r = await patch({ name: 'Nope' });
    expect(r.status).toBe(401);
  });

  it('returns 400 for a blank name', async () => {
    await asUser();
    const r = await patch({ name: '   ' });
    expect(r.status).toBe(400);
  });

  it('persists an avatar URL and clears it with null (#199)', async () => {
    const u = await asUser();
    const url = 'https://example.com/api/files/abc?sig=x&exp=1';
    const r = await patch({ avatarUrl: url });
    expect(r.status).toBe(200);
    expect((r.body as { avatarUrl: string | null }).avatarUrl).toBe(url);
    const { getDb } = await import('@/db/client');
    const schema = await import('@/db/schema');
    const [row] = await getDb().select().from(schema.users).where(eq(schema.users.id, u.userId));
    expect(row?.avatarUrl).toBe(url);

    const cleared = await patch({ avatarUrl: null });
    expect(cleared.status).toBe(200);
    const [row2] = await getDb().select().from(schema.users).where(eq(schema.users.id, u.userId));
    expect(row2?.avatarUrl).toBeNull();
  });

  it('accepts the relative signed-file avatar path returned by storeUpload (#199)', async () => {
    const u = await asUser();
    const relative = '/api/files/abc?sig=x&exp=1';
    const r = await patch({ avatarUrl: relative });
    expect(r.status).toBe(200);
    expect((r.body as { avatarUrl: string | null }).avatarUrl).toBe(relative);
    const { getDb } = await import('@/db/client');
    const schema = await import('@/db/schema');
    const [row] = await getDb().select().from(schema.users).where(eq(schema.users.id, u.userId));
    expect(row?.avatarUrl).toBe(relative);
  });
});
