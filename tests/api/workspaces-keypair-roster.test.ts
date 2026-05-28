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

async function seedKeypair(userId: string, fill: number) {
  await getDb()
    .insert(schema.userKeypairs)
    .values({
      userId,
      publicKey: Buffer.alloc(32, fill),
      encryptedPrivateKey: Buffer.alloc(60, 2),
      kdfSalt: Buffer.alloc(16, 3),
      kdfIters: 32768,
    });
}

async function get(workspaceId: string) {
  const { GET } = await import('@/app/api/workspaces/[id]/keypair-roster/route');
  return GET(new Request('http://localhost/x'), {
    params: Promise.resolve({ id: workspaceId }),
  });
}

describe('GET /api/workspaces/[id]/keypair-roster', () => {
  it('returns public keys only for members with a keypair', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await seedKeypair(owner.userId, 0xaa);
    // A second member, no keypair → excluded.
    const [u2] = await getDb()
      .insert(schema.users)
      .values({ email: 'u2@example.com', passwordHash: 'h', name: 'u2' })
      .returning();
    if (!u2) throw new Error('user insert failed');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: u2.id, role: 'editor' });

    await setSession(owner.userId);
    const res = await get(owner.workspaceId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ memberUserId: string; publicKey: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.memberUserId).toBe(owner.userId);
    expect(Buffer.from(body[0]?.publicKey ?? '', 'base64').byteLength).toBe(32);
    // Response must not include private/encrypted material.
    expect(JSON.stringify(body)).not.toMatch(/encryptedPrivateKey/i);
    expect(JSON.stringify(body)).not.toMatch(/kdfSalt/i);
  });

  it('returns 404 for cross-workspace ids', async () => {
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
