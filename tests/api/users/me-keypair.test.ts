import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { generateUserKeypair } from '@/lib/e2e/crypto';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts, user_keypairs, audit_log RESTART IDENTITY CASCADE`;
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

async function setSession(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function put(body: unknown) {
  const { PUT } = await import('@/app/api/users/me/keypair/route');
  return PUT(
    new Request('http://localhost/api/users/me/keypair', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function getRoute() {
  const { GET } = await import('@/app/api/users/me/keypair/route');
  return GET();
}

async function makeBody(passphrase = 'pw') {
  const sealed = await generateUserKeypair(passphrase);
  return {
    publicKey: sealed.publicKey.toString('base64'),
    encryptedPrivateKey: sealed.encryptedPrivateKey.toString('base64'),
    kdfSalt: sealed.kdfSalt.toString('base64'),
    kdfIters: sealed.kdfIters,
  };
}

describe('PUT/GET /api/users/me/keypair', () => {
  it('PUT persists the caller-scoped row and round-trips the byte lengths', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    const body = await makeBody();
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [row] = await getDb()
      .select()
      .from(schema.userKeypairs)
      .where(eq(schema.userKeypairs.userId, owner.userId));
    expect(row).toBeTruthy();
    expect(Buffer.from(row?.publicKey ?? Buffer.alloc(0)).byteLength).toBe(32);
    expect(Buffer.from(row?.encryptedPrivateKey ?? Buffer.alloc(0)).byteLength).toBe(60);
    expect(row?.kdfIters).toBe(32768);
  });

  it('GET reports enrolled:true with the base64 public key after enroll', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    const body = await makeBody();
    await put(body);
    const res = await getRoute();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { enrolled: boolean; publicKey?: string };
    expect(json.enrolled).toBe(true);
    expect(json.publicKey).toBe(body.publicKey);
    expect(Buffer.from(json.publicKey ?? '', 'base64').byteLength).toBe(32);
  });

  it('GET reports enrolled:false before enroll', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    const res = await getRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: false });
  });

  it('PUT with a different public key when a row exists returns 409', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    await put(await makeBody('pw1'));
    const res = await put(await makeBody('pw2'));
    expect(res.status).toBe(409);
  });

  it('idempotent re-PUT of the same public key returns 200', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    const body = await makeBody();
    expect((await put(body)).status).toBe(200);
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('PUT with wrong byte lengths returns 400', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    const good = await makeBody();
    // 31-byte public key
    const badPub = { ...good, publicKey: Buffer.alloc(31, 1).toString('base64') };
    expect((await put(badPub)).status).toBe(400);
    // 59-byte sealed blob
    const badSealed = { ...good, encryptedPrivateKey: Buffer.alloc(59, 1).toString('base64') };
    expect((await put(badSealed)).status).toBe(400);
  });

  it('PUT with malformed body returns 400', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    expect((await put({ publicKey: 'x' })).status).toBe(400);
  });

  it('unauthenticated PUT/GET returns 401', async () => {
    await setSession(null);
    expect((await put(await makeBody())).status).toBe(401);
    expect((await getRoute()).status).toBe(401);
  });

  it('a second user cannot read the first user row (scoped GET)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    await put(await makeBody());

    const other = await createTestWorkspaceWithUser(getDb(), {
      role: 'owner',
      email: 'other@example.com',
    });
    await setSession(other.userId);
    const res = await getRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: false });
  });
});
