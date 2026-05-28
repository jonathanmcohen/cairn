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

async function post(workspaceId: string, body: unknown) {
  const { POST } = await import('@/app/api/workspaces/[id]/e2e/enable/route');
  return POST(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: workspaceId }) },
  );
}

describe('POST /api/workspaces/[id]/e2e/enable', () => {
  it('rejects non-owner', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    // Add an editor in the same workspace.
    const [u2] = await getDb()
      .insert(schema.users)
      .values({ email: 'editor@example.com', passwordHash: 'h', name: 'editor' })
      .returning();
    if (!u2) throw new Error('user insert failed');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: u2.id, role: 'editor' });
    await seedKeypair(u2.id);

    await setSession(u2.id);
    const res = await post(owner.workspaceId, {
      wrapped: [
        { memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92).toString('base64') },
        { memberUserId: u2.id, wrappedWsk: Buffer.alloc(92).toString('base64') },
      ],
    });
    expect(res.status).toBe(403);
  });

  it('owner enables: inserts WSK rows + sets mode=workspace_wide + audit', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await setSession(owner.userId);

    const res = await post(owner.workspaceId, {
      wrapped: [
        { memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92, 0x7a).toString('base64') },
      ],
    });
    expect(res.status).toBe(200);

    const [ws] = await getDb()
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, owner.workspaceId));
    expect(ws?.e2eMode).toBe('workspace_wide');

    const rows = await getDb()
      .select()
      .from(schema.workspaceEncryptionKeys)
      .where(eq(schema.workspaceEncryptionKeys.workspaceId, owner.workspaceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyVersion).toBe(1);

    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, owner.workspaceId));
    expect(audits.some((a) => a.action === 'e2e.workspace.encrypted')).toBe(true);
  });

  it('refuses when mode already set (409)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    await getDb()
      .update(schema.workspaces)
      .set({ e2eMode: 'workspace_wide' })
      .where(eq(schema.workspaces.id, owner.workspaceId));
    await setSession(owner.userId);

    const res = await post(owner.workspaceId, {
      wrapped: [{ memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92).toString('base64') }],
    });
    expect(res.status).toBe(409);
  });

  it('refuses when roster does not cover every member (400)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const [u2] = await getDb()
      .insert(schema.users)
      .values({ email: 'editor@example.com', passwordHash: 'h', name: 'editor' })
      .returning();
    if (!u2) throw new Error('user insert failed');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: u2.id, role: 'editor' });
    await seedKeypair(u2.id);
    await setSession(owner.userId);

    const res = await post(owner.workspaceId, {
      // Only owner — missing u2.
      wrapped: [{ memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92).toString('base64') }],
    });
    expect(res.status).toBe(400);
  });

  it('refuses when a member has no keypair (409)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const [u2] = await getDb()
      .insert(schema.users)
      .values({ email: 'editor@example.com', passwordHash: 'h', name: 'editor' })
      .returning();
    if (!u2) throw new Error('user insert failed');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: u2.id, role: 'editor' });
    // NOTE: no keypair seeded for u2.
    await setSession(owner.userId);

    const res = await post(owner.workspaceId, {
      wrapped: [
        { memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92).toString('base64') },
        { memberUserId: u2.id, wrappedWsk: Buffer.alloc(92).toString('base64') },
      ],
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
      wrapped: [{ memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92).toString('base64') }],
    });
    expect(res.status).toBe(404);
  });
});
