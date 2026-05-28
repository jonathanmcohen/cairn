import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts, audit_log, workspace_encryption_keys, user_keypairs RESTART IDENTITY CASCADE`;
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
    .values({
      workspaceId,
      title: 'p',
      createdBy: userId,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      contentText: 'hello world',
    })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

async function enableE2E(workspaceId: string, ownerId: string) {
  await getDb()
    .update(schema.workspaces)
    .set({ e2eMode: 'workspace_wide' })
    .where(eq(schema.workspaces.id, workspaceId));
  await getDb()
    .insert(schema.workspaceEncryptionKeys)
    .values({
      workspaceId,
      memberUserId: ownerId,
      wrappedWsk: Buffer.alloc(92, 0xaa),
      keyVersion: 1,
    });
}

async function post(pageId: string, body: unknown) {
  const { POST } = await import('@/app/api/pages/[pageId]/encrypt-under-wsk/route');
  return POST(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ pageId }) },
  );
}

describe('POST /api/pages/[pageId]/encrypt-under-wsk', () => {
  it('happy path: writes ciphertext + blanks plaintext + flags page', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await enableE2E(owner.workspaceId, owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const ct = Buffer.alloc(40, 0xab);
    const res = await post(page.id, { contentEncrypted: ct.toString('base64') });
    expect(res.status).toBe(200);

    const [after] = await getDb().select().from(schema.pages).where(eq(schema.pages.id, page.id));
    expect(after?.encrypted).toBe(true);
    expect(after?.encryptedUnderWsk).toBe(true);
    expect(after?.contentText).toBe('');
    expect(Buffer.from(after?.contentEncrypted ?? Buffer.alloc(0)).equals(ct)).toBe(true);

    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, owner.workspaceId));
    expect(audits.some((a) => a.action === 'e2e.page.encrypted')).toBe(true);
  });

  it('refuses when workspace mode is off (409)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const res = await post(page.id, {
      contentEncrypted: Buffer.alloc(40).toString('base64'),
    });
    expect(res.status).toBe(409);
  });

  it('idempotent on identical re-call (200 noop)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await enableE2E(owner.workspaceId, owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const ct = Buffer.alloc(40, 0xab);
    const first = await post(page.id, { contentEncrypted: ct.toString('base64') });
    expect(first.status).toBe(200);
    const second = await post(page.id, { contentEncrypted: ct.toString('base64') });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { ok: boolean; alreadyEncrypted?: boolean };
    expect(body.alreadyEncrypted).toBe(true);
  });

  it('refuses double-encrypt with DIFFERENT content (409)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await enableE2E(owner.workspaceId, owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const ctA = Buffer.alloc(40, 0xab);
    const ctB = Buffer.alloc(40, 0xcd);
    const first = await post(page.id, { contentEncrypted: ctA.toString('base64') });
    expect(first.status).toBe(200);
    const second = await post(page.id, { contentEncrypted: ctB.toString('base64') });
    expect(second.status).toBe(409);
  });

  it('requires editor access (viewer rejected with 403)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await enableE2E(owner.workspaceId, owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);

    // Add a viewer.
    const [viewer] = await getDb()
      .insert(schema.users)
      .values({ email: 'viewer@example.com', passwordHash: 'h', name: 'v' })
      .returning();
    if (!viewer) throw new Error('user insert failed');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: viewer.id, role: 'viewer' });
    await setSession(viewer.id);

    const res = await post(page.id, {
      contentEncrypted: Buffer.alloc(40).toString('base64'),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for cross-workspace pageId', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await enableE2E(owner.workspaceId, owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);

    const stranger = await createTestWorkspaceWithUser(getDb(), {
      role: 'owner',
      email: 'stranger@example.com',
    });
    await setSession(stranger.userId);

    const res = await post(page.id, {
      contentEncrypted: Buffer.alloc(40).toString('base64'),
    });
    expect(res.status).toBe(404);
  });
});
