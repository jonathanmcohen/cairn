import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { beginEnrollment, confirmEnrollment } from '@/lib/auth/two-factor';
import { env } from '@/lib/env';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();
const codeFor = (secret: string) => generateSync({ secret, crypto, base32 });

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
  await sql`TRUNCATE user_totp, audit_log, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function enrollUser(userId: string, email: string) {
  const out = await beginEnrollment(getDb(), { userId, account: email, key: env().AUTH_SECRET });
  await confirmEnrollment(getDb(), {
    userId,
    token: codeFor(out.secret),
    key: env().AUTH_SECRET,
  });
  return out;
}

async function getCount() {
  const { GET } = await import('@/app/api/auth/2fa/recovery-codes/route');
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

async function regenerate() {
  const { POST } = await import('@/app/api/auth/2fa/recovery-codes/route');
  const res = await POST();
  return { status: res.status, body: await res.json() };
}

describe('/api/auth/2fa/recovery-codes', () => {
  it('GET unauthenticated → 401', async () => {
    await setUser(null);
    expect((await getCount()).status).toBe(401);
  });

  it('POST unauthenticated → 401', async () => {
    await setUser(null);
    expect((await regenerate()).status).toBe(401);
  });

  it('GET returns remaining count (10 after enroll)', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await enrollUser(me.userId, 'a@b.com');
    await setUser(me.userId);
    const r = await getCount();
    expect(r.status).toBe(200);
    expect((r.body as { remaining: number }).remaining).toBe(10);
  });

  it('POST when 2FA disabled → 409', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(me.userId);
    const r = await regenerate();
    expect(r.status).toBe(409);
  });

  it('POST when enabled → 10 fresh codes, count resets to 10', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await enrollUser(me.userId, 'c@d.com');
    await setUser(me.userId);
    const r = await regenerate();
    expect(r.status).toBe(200);
    const codes = (r.body as { recoveryCodes: string[] }).recoveryCodes;
    expect(codes).toHaveLength(10);
    expect((await getCount()).body.remaining).toBe(10);
  });
});
