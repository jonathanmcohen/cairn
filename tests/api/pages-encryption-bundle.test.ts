import { eq } from 'drizzle-orm';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts, audit_log, page_encryption_keys, user_keypairs RESTART IDENTITY CASCADE`;
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

async function setSession(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

async function seedKeypair(userId: string) {
  await getDb()
    .insert(schema.userKeypairs)
    .values({
      userId,
      publicKey: Buffer.alloc(32, 1),
      encryptedPrivateKey: Buffer.alloc(60, 2),
      kdfSalt: Buffer.alloc(16, 3),
      kdfIters: 32768,
    });
}

async function makePage(workspaceId: string, userId: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title: 'p', createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

async function getBundle(pageId: string) {
  const { GET } = await import('@/app/api/pages/[pageId]/encryption-bundle/route');
  return GET(new Request(`http://localhost/api/pages/${pageId}/encryption-bundle`), {
    params: Promise.resolve({ pageId }),
  });
}

describe('GET /api/pages/[pageId]/encryption-bundle', () => {
  it('returns null bundle when page is not encrypted', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const res = await getBundle(page.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contentEncrypted: string | null; wrappedDekForMe: string | null };
    expect(body.contentEncrypted).toBeNull();
    expect(body.wrappedDekForMe).toBeNull();
  });

  it('returns base64 bundle for an enrolled page member', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);

    const ct = Buffer.from('encrypted-content');
    const wrapped = Buffer.alloc(92, 0xab);
    await getDb()
      .update(schema.pages)
      .set({ encrypted: true, contentEncrypted: ct })
      .where(eq(schema.pages.id, page.id));
    await getDb().insert(schema.pageEncryptionKeys).values({
      pageId: page.id,
      memberUserId: owner.userId,
      wrappedDek: wrapped,
    });

    await setSession(owner.userId);
    const res = await getBundle(page.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contentEncrypted: string; wrappedDekForMe: string };
    expect(Buffer.from(body.contentEncrypted, 'base64').equals(ct)).toBe(true);
    expect(Buffer.from(body.wrappedDekForMe, 'base64').equals(wrapped)).toBe(true);
  });

  it('returns 403 when page is encrypted but caller has no wrapped DEK', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const page = await makePage(owner.workspaceId, owner.userId);
    await getDb()
      .update(schema.pages)
      .set({ encrypted: true, contentEncrypted: Buffer.from('x') })
      .where(eq(schema.pages.id, page.id));

    await setSession(owner.userId);
    const res = await getBundle(page.id);
    expect(res.status).toBe(403);
  });

  it('returns 404 for a cross-workspace caller', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const page = await makePage(owner.workspaceId, owner.userId);
    const stranger = await createTestWorkspaceWithUser(getDb(), {
      role: 'owner',
      email: 'stranger@example.com',
    });
    await setSession(stranger.userId);

    const res = await getBundle(page.id);
    expect(res.status).toBe(404);
  });
});

