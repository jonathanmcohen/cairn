/**
 * v0.9.0 G1 P8 — admin MFA policy route.
 *
 * Verifies: admin upserts policy; non-admin gets 403; cross-workspace gets 404;
 * idempotent re-PUT (onConflictDoUpdate); audit row written.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../../helpers/db';
import { createTestWorkspaceWithUser } from '../../../helpers/fixtures';

let activeCookie: { name: string; value: string } | undefined;

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
  cookies: async () => ({
    get: () => activeCookie,
    set: () => {},
    delete: () => {},
  }),
}));

async function actAs(userId: string, workspaceId: string): Promise<void> {
  const a = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  a.__set({ userId });
  activeCookie = { name: 'cairn_ws', value: workspaceId };
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(48);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE workspace_mfa_policies, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  activeCookie = undefined;
});

describe('PUT /api/admin/workspaces/:workspaceId/mfa-policy', () => {
  it('admin upserts the policy and writes mfa.policy_changed audit', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const { PUT } = await import('@/app/api/admin/workspaces/[workspaceId]/mfa-policy/route');
    const res = await PUT(
      new Request(`http://localhost/api/admin/workspaces/${u.workspaceId}/mfa-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requireMfa: true, methods: ['totp', 'webauthn'] }),
      }),
      { params: Promise.resolve({ workspaceId: u.workspaceId }) },
    );
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.workspaceMfaPolicies)
      .where(eq(schema.workspaceMfaPolicies.workspaceId, u.workspaceId));
    expect(row?.requireMfa).toBe(true);
    expect(row?.methods).toEqual(['totp', 'webauthn']);

    const audit = (await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId))) as Array<{ action: string }>;
    expect(audit.some((r) => r.action === 'mfa.policy_changed')).toBe(true);
  });

  it('re-PUT is idempotent (onConflictDoUpdate updates the row in place)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const { PUT } = await import('@/app/api/admin/workspaces/[workspaceId]/mfa-policy/route');
    await PUT(
      new Request(`http://localhost/api/admin/workspaces/${u.workspaceId}/mfa-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requireMfa: false, methods: ['totp'] }),
      }),
      { params: Promise.resolve({ workspaceId: u.workspaceId }) },
    );
    await PUT(
      new Request(`http://localhost/api/admin/workspaces/${u.workspaceId}/mfa-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requireMfa: true, methods: ['webauthn'] }),
      }),
      { params: Promise.resolve({ workspaceId: u.workspaceId }) },
    );
    const rows = await db.select().from(schema.workspaceMfaPolicies);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requireMfa).toBe(true);
    expect(rows[0]?.methods).toEqual(['webauthn']);
  });

  it('non-admin gets 403', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId, u.workspaceId);
    const { PUT } = await import('@/app/api/admin/workspaces/[workspaceId]/mfa-policy/route');
    const res = await PUT(
      new Request(`http://localhost/api/admin/workspaces/${u.workspaceId}/mfa-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requireMfa: true, methods: ['webauthn'] }),
      }),
      { params: Promise.resolve({ workspaceId: u.workspaceId }) },
    );
    expect(res.status).toBe(403);
  });

  it('cross-workspace returns 404 (never leak existence)', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const b = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(b.userId, b.workspaceId);
    const { PUT } = await import('@/app/api/admin/workspaces/[workspaceId]/mfa-policy/route');
    const res = await PUT(
      new Request(`http://localhost/api/admin/workspaces/${a.workspaceId}/mfa-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requireMfa: true, methods: ['webauthn'] }),
      }),
      { params: Promise.resolve({ workspaceId: a.workspaceId }) },
    );
    expect(res.status).toBe(404);
    // The OTHER workspace's policy never got written.
    const rows = await db.select().from(schema.workspaceMfaPolicies);
    expect(rows).toHaveLength(0);
  });

  it('rejects invalid body (empty methods array)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const { PUT } = await import('@/app/api/admin/workspaces/[workspaceId]/mfa-policy/route');
    const res = await PUT(
      new Request(`http://localhost/api/admin/workspaces/${u.workspaceId}/mfa-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requireMfa: true, methods: [] }),
      }),
      { params: Promise.resolve({ workspaceId: u.workspaceId }) },
    );
    expect(res.status).toBe(400);
  });

  it('GET returns defaults when no row exists', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const { GET } = await import('@/app/api/admin/workspaces/[workspaceId]/mfa-policy/route');
    const res = await GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ workspaceId: u.workspaceId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requireMfa: boolean; methods: string[] };
    expect(body.requireMfa).toBe(false);
    expect(body.methods).toEqual(['totp', 'webauthn']);
  });
});
