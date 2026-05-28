import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
import { dayWindowStart, monthWindowStart } from '@/lib/auth/pat-quota-windows';
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

async function seedPat(workspaceId: string, userId: string, name = 't') {
  const { row } = await mintPat(db, {
    userId,
    workspaceId,
    name,
    scopes: ['pages.read'],
    mcpTools: [],
    expiresAt: null,
  });
  await db.insert(schema.patQuotaUsage).values([
    {
      tokenId: row.id,
      windowStart: dayWindowStart(new Date()),
      windowKind: 'day',
      requests: 99,
      bytes: 0,
    },
    {
      tokenId: row.id,
      windowStart: monthWindowStart(new Date()),
      windowKind: 'month',
      requests: 500,
      bytes: 0,
    },
  ]);
  return row.id;
}

describe('POST /api/admin/pats/[tokenId]/reset-quota', () => {
  it('clears active day + month rows and returns 204', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const tokenId = await seedPat(admin.workspaceId, admin.userId);
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/pats/[tokenId]/reset-quota/route');
    const res = await POST(
      new Request(`http://localhost/api/admin/pats/${tokenId}/reset-quota`, { method: 'POST' }),
      { params: Promise.resolve({ tokenId }) },
    );
    expect(res.status).toBe(204);
    const rows = await db
      .select()
      .from(schema.patQuotaUsage)
      .where(eq(schema.patQuotaUsage.tokenId, tokenId));
    expect(rows).toHaveLength(0);
  });

  it('preserves historical (pre-current-window) day rows after reset', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const tokenId = await seedPat(admin.workspaceId, admin.userId);
    // Seed a historical row 7 days ago in addition to today's current rows.
    const sevenDaysAgo = dayWindowStart(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    await db.insert(schema.patQuotaUsage).values({
      tokenId,
      windowStart: sevenDaysAgo,
      windowKind: 'day',
      requests: 42,
      bytes: 0,
    });
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/pats/[tokenId]/reset-quota/route');
    const res = await POST(
      new Request(`http://localhost/api/admin/pats/${tokenId}/reset-quota`, { method: 'POST' }),
      { params: Promise.resolve({ tokenId }) },
    );
    expect(res.status).toBe(204);
    const rows = await db
      .select()
      .from(schema.patQuotaUsage)
      .where(eq(schema.patQuotaUsage.tokenId, tokenId));
    // Current day + current month deleted; historical T-7 row preserved.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requests).toBe(42);
    expect(rows[0]?.windowStart.toISOString()).toBe(sevenDaysAgo.toISOString());
  });

  it('404s for cross-workspace token (existence-hiding)', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const otherAdmin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const foreignToken = await seedPat(otherAdmin.workspaceId, otherAdmin.userId, 'foreign');
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/pats/[tokenId]/reset-quota/route');
    const res = await POST(
      new Request(`http://localhost/api/admin/pats/${foreignToken}/reset-quota`, {
        method: 'POST',
      }),
      { params: Promise.resolve({ tokenId: foreignToken }) },
    );
    expect(res.status).toBe(404);
    // Foreign token's rollup rows are untouched.
    const rows = await db
      .select()
      .from(schema.patQuotaUsage)
      .where(eq(schema.patQuotaUsage.tokenId, foreignToken));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('403s for editor', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const tokenId = await seedPat(owner.workspaceId, owner.userId);
    // Add an editor to the same workspace.
    const [editor] = await db
      .insert(schema.users)
      .values({ email: 'editor@x.test', passwordHash: 'h', name: 'editor' })
      .returning();
    if (!editor) throw new Error('editor seed failed');
    await db.insert(schema.workspaceMembers).values({
      workspaceId: owner.workspaceId,
      userId: editor.id,
      role: 'editor',
    });
    await actAs(editor.id, owner.workspaceId);
    const { POST } = await import('@/app/api/admin/pats/[tokenId]/reset-quota/route');
    const res = await POST(
      new Request(`http://localhost/api/admin/pats/${tokenId}/reset-quota`, { method: 'POST' }),
      { params: Promise.resolve({ tokenId }) },
    );
    expect(res.status).toBe(403);
  });

  it('records pat.quota_reset audit with tokenId only', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const tokenId = await seedPat(admin.workspaceId, admin.userId);
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/pats/[tokenId]/reset-quota/route');
    await POST(
      new Request(`http://localhost/api/admin/pats/${tokenId}/reset-quota`, { method: 'POST' }),
      { params: Promise.resolve({ tokenId }) },
    );
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'pat.quota_reset'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.targetId).toBe(tokenId);
    expect(audits[0]?.targetType).toBe('personal_access_token');
    expect(audits[0]?.workspaceId).toBe(admin.workspaceId);
    expect(audits[0]?.actorUserId).toBe(admin.userId);
  });

  it('does not delete other tokens rollups', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const t1 = await seedPat(admin.workspaceId, admin.userId, 't1');
    const t2 = await seedPat(admin.workspaceId, admin.userId, 't2');
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/pats/[tokenId]/reset-quota/route');
    await POST(
      new Request(`http://localhost/api/admin/pats/${t1}/reset-quota`, { method: 'POST' }),
      {
        params: Promise.resolve({ tokenId: t1 }),
      },
    );
    const t1Rows = await db
      .select()
      .from(schema.patQuotaUsage)
      .where(eq(schema.patQuotaUsage.tokenId, t1));
    const t2Rows = await db
      .select()
      .from(schema.patQuotaUsage)
      .where(eq(schema.patQuotaUsage.tokenId, t2));
    expect(t1Rows).toHaveLength(0);
    expect(t2Rows.length).toBeGreaterThan(0);
  });
});
