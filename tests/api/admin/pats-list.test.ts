import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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
  await sql`TRUNCATE pat_quota_usage, personal_access_tokens, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  activeCookie = undefined;
});

describe('GET /api/admin/pats', () => {
  it('returns rows for admin', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await mintPat(db, {
      userId: admin.userId,
      workspaceId: admin.workspaceId,
      name: 'admin-pat',
      scopes: ['pages.read'],
      mcpTools: [],
      expiresAt: null,
    });
    await actAs(admin.userId, admin.workspaceId);
    const { GET } = await import('@/app/api/admin/pats/route');
    const res = await GET(new Request('http://localhost/api/admin/pats'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ name: string }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.name).toBe('admin-pat');
  });

  it('403s for editor', async () => {
    const editor = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(editor.userId, editor.workspaceId);
    const { GET } = await import('@/app/api/admin/pats/route');
    const res = await GET(new Request('http://localhost/api/admin/pats'));
    expect(res.status).toBe(403);
  });

  it('401s when unauthenticated', async () => {
    const { GET } = await import('@/app/api/admin/pats/route');
    const res = await GET(new Request('http://localhost/api/admin/pats'));
    expect(res.status).toBe(401);
  });

  it('response body does not leak token_hash / cairn_pat_ secrets', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const { token } = await mintPat(db, {
      userId: admin.userId,
      workspaceId: admin.workspaceId,
      name: 'secret-pat',
      scopes: ['pages.read'],
      mcpTools: [],
      expiresAt: null,
    });
    await actAs(admin.userId, admin.workspaceId);
    const { GET } = await import('@/app/api/admin/pats/route');
    const res = await GET(new Request('http://localhost/api/admin/pats'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('cairn_pat_');
    expect(body).not.toContain('token_hash');
    expect(body).not.toContain(token);
  });
});
