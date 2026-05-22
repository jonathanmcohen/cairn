import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function actAs(userId: string): Promise<void> {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts
    RESTART IDENTITY CASCADE`;
});

/** Add a fresh user with `role` to an existing workspace; returns its ids. */
async function addMember(
  workspaceId: string,
  role: schema.MemberRole,
): Promise<{ userId: string; email: string }> {
  const email = `${role}-${randomBytes(4).toString('hex')}@x.com`;
  const [u] = await getDb()
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: role })
    .returning();
  if (!u) throw new Error('failed to create member');
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId: u.id, role });
  return { userId: u.id, email };
}

// (role, requiredRole, expectAllowed) — exercises each ceiling.
const RBAC_CASES: Array<{
  role: schema.MemberRole;
  required: schema.MemberRole;
  allowed: boolean;
}> = [
  { role: 'viewer', required: 'editor', allowed: false }, // viewer cannot mutate
  { role: 'editor', required: 'editor', allowed: true },
  { role: 'editor', required: 'admin', allowed: false }, // editor cannot admin
  { role: 'admin', required: 'admin', allowed: true },
  { role: 'admin', required: 'owner', allowed: false }, // admin cannot owner-only
  { role: 'owner', required: 'owner', allowed: true },
];

describe('RBAC role ceilings', () => {
  for (const c of RBAC_CASES) {
    it(`${c.role} ${c.allowed ? 'may' : 'may NOT'} act at ${c.required}`, async () => {
      const ws = await createTestWorkspaceWithUser(getDb()); // owner
      const u = await addMember(ws.workspaceId, c.role);
      await actAs(u.userId);

      // requireRole throws HttpError(403) when below the ceiling.
      if (c.allowed) {
        await expect(requireRole(c.required)).resolves.toMatchObject({ role: c.role });
      } else {
        await expect(requireRole(c.required)).rejects.toBeInstanceOf(HttpError);
        await expect(requireRole(c.required)).rejects.toMatchObject({ status: 403 });
      }
    });
  }

  it('viewer hitting a mutation route gets 403, not a write', async () => {
    const ws = await createTestWorkspaceWithUser(getDb());
    const v = await addMember(ws.workspaceId, 'viewer');
    const page = await createPage(getDb(), {
      workspaceId: ws.workspaceId,
      createdBy: ws.userId,
      title: 'orig',
    });
    await actAs(v.userId);

    const route = await import('@/app/api/pages/[pageId]/route');
    const res = await route.PATCH(
      new Request(`http://t/api/pages/${page.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'pwned' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
    const [after] = await getDb().select().from(schema.pages).where(eq(schema.pages.id, page.id));
    expect(after?.title).toBe('orig'); // unchanged
  });

  it('editor hitting an admin-only route (api-key delete) gets 403', async () => {
    const ws = await createTestWorkspaceWithUser(getDb());
    const e = await addMember(ws.workspaceId, 'editor');
    await actAs(e.userId);

    const route = await import('@/app/api/api-keys/[id]/route');
    const res = await route.DELETE(new Request('http://t/api/api-keys/whatever'), {
      params: Promise.resolve({ id: randomBytes(8).toString('hex') }),
    });
    expect(res.status).toBe(403); // ceiling enforced before any not-found lookup
  });
});
