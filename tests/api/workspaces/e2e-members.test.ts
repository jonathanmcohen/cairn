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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts, user_keypairs RESTART IDENTITY CASCADE`;
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

async function get(workspaceId: string) {
  const { GET } = await import('@/app/api/workspaces/[id]/e2e/members/route');
  return GET(new Request('http://localhost/x'), {
    params: Promise.resolve({ id: workspaceId }),
  });
}

async function seedKeypair(userId: string) {
  await getDb()
    .insert(schema.userKeypairs)
    .values({
      userId,
      publicKey: Buffer.alloc(32, 0xaa),
      encryptedPrivateKey: Buffer.alloc(60, 2),
      kdfSalt: Buffer.alloc(16, 3),
      kdfIters: 32768,
    });
}

describe('GET /api/workspaces/[id]/e2e/members', () => {
  it('owner gets one entry per member with hasKeypair flag and no key material', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId);
    const [u2] = await getDb()
      .insert(schema.users)
      .values({ email: 'u2@example.com', passwordHash: 'h', name: 'Member Two' })
      .returning();
    if (!u2) throw new Error('user insert failed');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: u2.id, role: 'editor' });

    await setSession(owner.userId);
    const res = await get(owner.workspaceId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      userId: string;
      name: string;
      email: string;
      hasKeypair: boolean;
    }>;
    expect(body).toHaveLength(2);
    const ownerRow = body.find((r) => r.userId === owner.userId);
    const memberRow = body.find((r) => r.userId === u2.id);
    expect(ownerRow?.hasKeypair).toBe(true);
    expect(memberRow?.hasKeypair).toBe(false);
    expect(memberRow?.name).toBe('Member Two');
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/encryptedPrivateKey/i);
    expect(json).not.toMatch(/publicKey/i);
  });

  it('non-owner (editor) gets 403', async () => {
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setSession(editor.userId);
    const res = await get(editor.workspaceId);
    expect(res.status).toBe(403);
  });

  it('cross-workspace id gets 404', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb(), {
      role: 'owner',
      email: 'other@example.com',
    });
    await setSession(owner.userId);
    const res = await get(other.workspaceId);
    expect(res.status).toBe(404);
  });
});
