import { and, eq } from 'drizzle-orm';
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

async function addMember(workspaceId: string, email: string, role: schema.MemberRole = 'editor') {
  const [u] = await getDb()
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: email })
    .returning();
  if (!u) throw new Error('user insert failed');
  await getDb()
    .insert(schema.workspaceMembers)
    .values({ workspaceId, userId: u.id, role });
  return u.id;
}

async function post(workspaceId: string, body: unknown) {
  const { POST } = await import(
    '@/app/api/workspaces/[workspaceId]/e2e/wrap-for-member/route'
  );
  return POST(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspaceId }) },
  );
}

describe('POST /api/workspaces/[workspaceId]/e2e/wrap-for-member', () => {
  it('happy path: caller wraps WSK for a new member', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await enableE2E(owner.workspaceId, owner.userId);

    const newId = await addMember(owner.workspaceId, 'newjoiner@example.com');
    await seedKeypair(newId);

    await setSession(owner.userId);
    const res = await post(owner.workspaceId, {
      memberUserId: newId,
      wrappedWsk: Buffer.alloc(92, 0xbb).toString('base64'),
    });
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select()
      .from(schema.workspaceEncryptionKeys)
      .where(
        and(
          eq(schema.workspaceEncryptionKeys.workspaceId, owner.workspaceId),
          eq(schema.workspaceEncryptionKeys.memberUserId, newId),
        ),
      );
    expect(row?.keyVersion).toBe(1);
    expect(Buffer.from(row?.wrappedWsk ?? Buffer.alloc(0)).byteLength).toBe(92);

    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, owner.workspaceId));
    expect(audits.some((a) => a.action === 'e2e.workspace.member_added')).toBe(true);
  });

  it('refuses when workspace is not in workspace_wide mode (409)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const newId = await addMember(owner.workspaceId, 'newjoiner@example.com');
    await seedKeypair(newId);
    await setSession(owner.userId);

    const res = await post(owner.workspaceId, {
      memberUserId: newId,
      wrappedWsk: Buffer.alloc(92).toString('base64'),
    });
    expect(res.status).toBe(409);
  });

  it('refuses caller without a current-version WSK row (403)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await enableE2E(owner.workspaceId, owner.userId);

    // Add a new joiner who lacks a WSK row entirely → cannot themselves wrap.
    const joinerId = await addMember(owner.workspaceId, 'joiner@example.com');
    await seedKeypair(joinerId);

    // Add another target that needs wrapping.
    const targetId = await addMember(owner.workspaceId, 'target@example.com');
    await seedKeypair(targetId);

    await setSession(joinerId);
    const res = await post(owner.workspaceId, {
      memberUserId: targetId,
      wrappedWsk: Buffer.alloc(92).toString('base64'),
    });
    expect(res.status).toBe(403);
  });

  it('refuses when target already has a WSK row (409)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await enableE2E(owner.workspaceId, owner.userId);
    await setSession(owner.userId);

    const res = await post(owner.workspaceId, {
      memberUserId: owner.userId,
      wrappedWsk: Buffer.alloc(92).toString('base64'),
    });
    expect(res.status).toBe(409);
  });

  it('refuses when target is not a workspace member (404)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await enableE2E(owner.workspaceId, owner.userId);

    // A user that exists but is NOT a member of this workspace.
    const [stranger] = await getDb()
      .insert(schema.users)
      .values({ email: 'stranger@example.com', passwordHash: 'h', name: 's' })
      .returning();
    if (!stranger) throw new Error('user insert failed');
    await seedKeypair(stranger.id);

    await setSession(owner.userId);
    const res = await post(owner.workspaceId, {
      memberUserId: stranger.id,
      wrappedWsk: Buffer.alloc(92).toString('base64'),
    });
    expect(res.status).toBe(404);
  });

  it('refuses when target has no keypair (409)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await enableE2E(owner.workspaceId, owner.userId);
    const newId = await addMember(owner.workspaceId, 'nokey@example.com');
    // NOTE: no seedKeypair for newId.
    await setSession(owner.userId);

    const res = await post(owner.workspaceId, {
      memberUserId: newId,
      wrappedWsk: Buffer.alloc(92).toString('base64'),
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 for cross-workspace ids', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb(), {
      role: 'owner',
      email: 'other@example.com',
    });
    await seedKeypair(owner.userId);
    await setSession(owner.userId);
    const res = await post(other.workspaceId, {
      memberUserId: owner.userId,
      wrappedWsk: Buffer.alloc(92).toString('base64'),
    });
    expect(res.status).toBe(404);
  });
});
