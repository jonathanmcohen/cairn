import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

async function setUser(c: { userId: string } | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}

async function addMember(workspaceId: string, userId: string, role: schema.MemberRole) {
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

async function call(id: string): Promise<{ status: number }> {
  const { POST } = await import('@/app/api/workspaces/[id]/leave/route');
  const res = await POST(
    new Request(`http://localhost/api/workspaces/${id}/leave`, { method: 'POST' }),
    {
      params: Promise.resolve({ id }),
    },
  );
  return { status: res.status };
}

describe('POST /api/workspaces/[id]/leave', () => {
  it('an editor leaves and the membership is gone', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'owner' }); // throwaway user
    await addMember(owner.workspaceId, editor.userId, 'editor');
    await setUser({ userId: editor.userId });

    const r = await call(owner.workspaceId);
    expect(r.status).toBe(200);
    const left = await getDb()
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, owner.workspaceId),
          eq(schema.workspaceMembers.userId, editor.userId),
        ),
      );
    expect(left).toHaveLength(0);
  });

  it('the sole owner is rejected with 409', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser({ userId: owner.userId });
    const r = await call(owner.workspaceId);
    expect(r.status).toBe(409);
  });

  it('a non-member is 404', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const stranger = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser({ userId: stranger.userId });
    const r = await call(owner.workspaceId);
    expect(r.status).toBe(404);
  });

  it('unauthenticated is 401', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser(null);
    const r = await call(owner.workspaceId);
    expect(r.status).toBe(401);
  });
});
