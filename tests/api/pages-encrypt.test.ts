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

async function makePage(workspaceId: string, userId: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title: 'Secrets', createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
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

async function addMember(
  workspaceId: string,
  email: string,
  role: schema.MemberRole = 'editor',
): Promise<string> {
  const [u] = await getDb()
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: email })
    .returning();
  if (!u) throw new Error('user insert failed');
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId: u.id, role });
  return u.id;
}

async function encryptCall(pageId: string, body: unknown) {
  const { POST } = await import('@/app/api/pages/[pageId]/encrypt/route');
  const res = await POST(
    new Request(`http://localhost/api/pages/${pageId}/encrypt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ pageId }) },
  );
  return res;
}

describe('POST /api/pages/[pageId]/encrypt', () => {
  it('viewer is forbidden (403)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const viewerId = await addMember(owner.workspaceId, 'viewer@example.com', 'viewer');
    await seedKeypair(viewerId);
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(viewerId);

    const res = await encryptCall(page.id, {
      contentEncrypted: Buffer.alloc(60).toString('base64'),
      wrappedDeks: [
        { memberUserId: owner.userId, wrappedDek: Buffer.alloc(92).toString('base64') },
        { memberUserId: viewerId, wrappedDek: Buffer.alloc(92).toString('base64') },
      ],
    });
    expect(res.status).toBe(403);
  });

  it('writes ciphertext + wrapped DEKs + sets encrypted=true (single-member workspace)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const ct = Buffer.from('cipher-bytes-of-page-content');
    const wrapped = Buffer.alloc(92, 0xaa);

    const res = await encryptCall(page.id, {
      contentEncrypted: ct.toString('base64'),
      wrappedDeks: [{ memberUserId: owner.userId, wrappedDek: wrapped.toString('base64') }],
    });
    expect(res.status).toBe(200);

    const [updated] = await getDb().select().from(schema.pages).where(eq(schema.pages.id, page.id));
    expect(updated?.encrypted).toBe(true);
    expect(updated?.contentText).toBe('');
    expect(updated?.contentEncrypted).not.toBeNull();
    expect(Buffer.from(updated?.contentEncrypted as Buffer).equals(ct)).toBe(true);

    const keys = await getDb()
      .select()
      .from(schema.pageEncryptionKeys)
      .where(eq(schema.pageEncryptionKeys.pageId, page.id));
    expect(keys).toHaveLength(1);
    expect(Buffer.from(keys[0]!.wrappedDek).equals(wrapped)).toBe(true);

    // Audit row.
    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, page.id));
    expect(audits.some((a) => a.action === 'e2e.page.encrypted')).toBe(true);
  });

  it('rejects payloads that do not cover every workspace member (400)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const otherId = await addMember(owner.workspaceId, 'other@example.com', 'editor');
    await seedKeypair(otherId);
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const res = await encryptCall(page.id, {
      contentEncrypted: Buffer.alloc(60).toString('base64'),
      wrappedDeks: [
        { memberUserId: owner.userId, wrappedDek: Buffer.alloc(92).toString('base64') },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('rejects when a covered member has no registered keypair (409)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const otherId = await addMember(owner.workspaceId, 'other2@example.com', 'editor');
    // No keypair for otherId — should 409.
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const res = await encryptCall(page.id, {
      contentEncrypted: Buffer.alloc(60).toString('base64'),
      wrappedDeks: [
        { memberUserId: owner.userId, wrappedDek: Buffer.alloc(92).toString('base64') },
        { memberUserId: otherId, wrappedDek: Buffer.alloc(92).toString('base64') },
      ],
    });
    expect(res.status).toBe(409);
  });

  it('is idempotent — second call rotates the DEK', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const wrappedA = Buffer.alloc(92, 0xaa);
    const wrappedB = Buffer.alloc(92, 0xbb);

    const body = (w: Buffer) => ({
      contentEncrypted: Buffer.alloc(60).toString('base64'),
      wrappedDeks: [{ memberUserId: owner.userId, wrappedDek: w.toString('base64') }],
    });

    const first = await encryptCall(page.id, body(wrappedA));
    expect(first.status).toBe(200);
    const second = await encryptCall(page.id, body(wrappedB));
    expect(second.status).toBe(200);

    const keys = await getDb()
      .select()
      .from(schema.pageEncryptionKeys)
      .where(eq(schema.pageEncryptionKeys.pageId, page.id));
    expect(keys).toHaveLength(1);
    expect(Buffer.from(keys[0]!.wrappedDek).equals(wrappedB)).toBe(true);
  });

  it('rejects malformed body (400)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const res = await encryptCall(page.id, { whoami: 'nope' });
    expect(res.status).toBe(400);
  });
});
