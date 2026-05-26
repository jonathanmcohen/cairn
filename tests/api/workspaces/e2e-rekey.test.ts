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

async function addMember(workspaceId: string, email: string) {
  const [u] = await getDb()
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: email })
    .returning();
  if (!u) throw new Error('user insert failed');
  await getDb()
    .insert(schema.workspaceMembers)
    .values({ workspaceId, userId: u.id, role: 'editor' });
  return u.id;
}

async function makePage(workspaceId: string, userId: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title: 'p', createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p.id;
}

async function post(workspaceId: string, body: unknown) {
  const { POST } = await import('@/app/api/workspaces/[workspaceId]/e2e/rekey/route');
  return POST(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspaceId }) },
  );
}

describe('POST /api/workspaces/[workspaceId]/e2e/rekey', () => {
  it('happy path: owner rotates WSK + bumps key_version + re-encrypts pages', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await enableE2E(owner.workspaceId, owner.userId);
    const pageA = await makePage(owner.workspaceId, owner.userId);
    const pageB = await makePage(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const newCtA = Buffer.alloc(40, 0xaa);
    const newCtB = Buffer.alloc(40, 0xbb);

    const res = await post(owner.workspaceId, {
      wrapped: [
        { memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92, 0xcc).toString('base64') },
      ],
      pageBundles: [
        { pageId: pageA, contentEncrypted: newCtA.toString('base64') },
        { pageId: pageB, contentEncrypted: newCtB.toString('base64') },
      ],
      removedMemberId: null,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; keyVersion: number };
    expect(body.keyVersion).toBe(2);

    // key_version bumped on remaining row.
    const rows = await getDb()
      .select()
      .from(schema.workspaceEncryptionKeys)
      .where(eq(schema.workspaceEncryptionKeys.workspaceId, owner.workspaceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyVersion).toBe(2);
    expect(Buffer.from(rows[0]?.wrappedWsk ?? Buffer.alloc(0)).equals(Buffer.alloc(92, 0xcc))).toBe(
      true,
    );

    // Pages re-encrypted.
    const pageRows = await getDb()
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, owner.workspaceId));
    for (const p of pageRows) {
      expect(p.encrypted).toBe(true);
      expect(p.encryptedUnderWsk).toBe(true);
      expect(p.contentText).toBe('');
      expect(p.contentEncrypted).not.toBeNull();
    }

    // Audit chain.
    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, owner.workspaceId));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('e2e.workspace.rekey_started');
    expect(actions).toContain('e2e.workspace.rekey_completed');
  });

  it('records member_removed audit when removedMemberId is set', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await enableE2E(owner.workspaceId, owner.userId);
    const removedId = await addMember(owner.workspaceId, 'removed@example.com');
    await seedKeypair(removedId);
    // Removed member starts with a WSK row pre-rekey.
    await getDb()
      .insert(schema.workspaceEncryptionKeys)
      .values({
        workspaceId: owner.workspaceId,
        memberUserId: removedId,
        wrappedWsk: Buffer.alloc(92, 0xee),
        keyVersion: 1,
      });
    // Caller orchestrates removal: drop from workspace_members BEFORE calling rekey
    // (matches what an admin UI would do).
    await getDb()
      .delete(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, removedId));

    await setSession(owner.userId);
    const res = await post(owner.workspaceId, {
      wrapped: [
        { memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92, 0x11).toString('base64') },
      ],
      pageBundles: [],
      removedMemberId: removedId,
    });
    expect(res.status).toBe(200);

    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, owner.workspaceId));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('e2e.workspace.member_removed');
    expect(actions).toContain('e2e.workspace.rekey_started');
    expect(actions).toContain('e2e.workspace.rekey_completed');

    // Removed member's WSK row gone.
    const rows = await getDb()
      .select()
      .from(schema.workspaceEncryptionKeys)
      .where(eq(schema.workspaceEncryptionKeys.workspaceId, owner.workspaceId));
    expect(rows.map((r) => r.memberUserId)).toEqual([owner.userId]);
  });

  it('rejects non-owner', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await enableE2E(owner.workspaceId, owner.userId);
    const otherId = await addMember(owner.workspaceId, 'editor@example.com');
    await seedKeypair(otherId);
    await setSession(otherId);

    const res = await post(owner.workspaceId, {
      wrapped: [
        { memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92).toString('base64') },
      ],
      pageBundles: [],
      removedMemberId: null,
    });
    expect(res.status).toBe(403);
  });

  it('refuses partial coverage (400)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await enableE2E(owner.workspaceId, owner.userId);
    const otherId = await addMember(owner.workspaceId, 'editor@example.com');
    await seedKeypair(otherId);
    await setSession(owner.userId);

    const res = await post(owner.workspaceId, {
      // Only owner — missing otherId.
      wrapped: [
        { memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92).toString('base64') },
      ],
      pageBundles: [],
      removedMemberId: null,
    });
    expect(res.status).toBe(400);
  });

  it('refuses when workspace is not in workspace_wide mode (409)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await setSession(owner.userId);

    const res = await post(owner.workspaceId, {
      wrapped: [
        { memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92).toString('base64') },
      ],
      pageBundles: [],
      removedMemberId: null,
    });
    expect(res.status).toBe(409);
  });
});
