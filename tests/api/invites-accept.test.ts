import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, invite_tokens, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function makeUser(email: string) {
  const [u] = await getDb()
    .insert(schema.users)
    .values({ email: email.toLowerCase(), passwordHash: 'h', name: 'U' })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}

async function makeInvite(workspaceId: string, email: string, role: schema.MemberRole = 'editor') {
  const [t] = await getDb()
    .insert(schema.inviteTokens)
    .values({
      workspaceId,
      email: email.toLowerCase(),
      role,
      token: `tok_${Math.random().toString(36).slice(2)}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  if (!t) throw new Error('invite insert failed');
  return t;
}

async function call(body: unknown): Promise<{ status: number }> {
  const { POST } = await import('@/app/api/invites/accept/route');
  const res = await POST(
    new Request('http://localhost/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status };
}

describe('POST /api/invites/accept', () => {
  it('matching email → joins + token consumed + active ws cookie set', async () => {
    cookieSets.length = 0;
    const host = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const userId = await makeUser('joiner@x.com');
    const invite = await makeInvite(host.workspaceId, 'joiner@x.com', 'editor');
    await setUser({ userId });

    const r = await call({ token: invite.token });
    expect(r.status).toBe(200);
    const member = await getDb()
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, userId));
    expect(member[0]?.role).toBe('editor');
    expect(cookieSets).toContainEqual({ name: 'cairn_ws', value: host.workspaceId });
  });

  it('email mismatch → 403', async () => {
    const host = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const userId = await makeUser('me@x.com');
    const invite = await makeInvite(host.workspaceId, 'other@x.com');
    await setUser({ userId });
    const r = await call({ token: invite.token });
    expect(r.status).toBe(403);
  });

  it('already-used → 400', async () => {
    const host = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const userId = await makeUser('used@x.com');
    const invite = await makeInvite(host.workspaceId, 'used@x.com');
    await getDb()
      .update(schema.inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.inviteTokens.id, invite.id));
    await setUser({ userId });
    const r = await call({ token: invite.token });
    expect(r.status).toBe(400);
  });

  it('unauthenticated → 401', async () => {
    const host = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const invite = await makeInvite(host.workspaceId, 'x@x.com');
    await setUser(null);
    const r = await call({ token: invite.token });
    expect(r.status).toBe(401);
  });
});
