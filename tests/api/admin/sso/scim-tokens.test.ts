import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { hashScimToken } from '@/lib/sso/scim-token';
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
  await sql`TRUNCATE scim_tokens, external_identities, idp_configurations, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  activeCookie = undefined;
});

describe('admin SCIM tokens', () => {
  it('admin POST mints a token, returns raw token once, writes audit', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const { POST } = await import('@/app/api/admin/sso/scim-tokens/route');
    const res = await POST(
      new Request('http://localhost/api/admin/sso/scim-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Okta SCIM',
          scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; raw: string; tokenHashPrefix: string };
    expect(body.raw).toMatch(/^cairn_scim_[0-9a-f]{64}$/);
    expect(body.tokenHashPrefix.length).toBeGreaterThan(0);

    // DB row stores only the hash, not the raw:
    const [row] = await db
      .select()
      .from(schema.scimTokens)
      .where(eq(schema.scimTokens.id, body.id));
    expect(row!.tokenHash).toBe(hashScimToken(body.raw));

    const auditRows = (await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId))) as Array<{ action: string }>;
    expect(auditRows.some((r) => r.action === 'sso.scim.token.minted')).toBe(true);
  });

  it('admin GET lists tokens without exposing tokenHash', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    await db.insert(schema.scimTokens).values({
      workspaceId: u.workspaceId,
      tokenHash: 'h'.repeat(64),
      name: 'list-test',
      scopes: ['users:read'],
      createdBy: u.userId,
    });
    const { GET } = await import('@/app/api/admin/sso/scim-tokens/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; name: string; scopes: string[]; tokenHash?: string }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.name).toBe('list-test');
    // tokenHash must NOT be in the GET response:
    expect(body.items[0]!.tokenHash).toBeUndefined();
  });

  it('non-admin POST returns 403', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId, u.workspaceId);
    const { POST } = await import('@/app/api/admin/sso/scim-tokens/route');
    const res = await POST(
      new Request('http://localhost/api/admin/sso/scim-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x', scopes: ['users:read'] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('admin DELETE revokes the token + writes sso.scim.token.revoked', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const [tok] = await db
      .insert(schema.scimTokens)
      .values({
        workspaceId: u.workspaceId,
        tokenHash: 'h'.repeat(64),
        name: 't',
        scopes: ['users:read'],
        createdBy: u.userId,
      })
      .returning({ id: schema.scimTokens.id });
    const { DELETE } = await import('@/app/api/admin/sso/scim-tokens/[tokenId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/admin/sso/scim-tokens/${tok!.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ tokenId: tok!.id }) },
    );
    expect(res.status).toBe(200);

    expect(
      await db.select().from(schema.scimTokens).where(eq(schema.scimTokens.id, tok!.id)),
    ).toHaveLength(0);
    const auditRows = (await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId))) as Array<{ action: string }>;
    expect(auditRows.some((r) => r.action === 'sso.scim.token.revoked')).toBe(true);
  });

  it('cross-workspace DELETE returns 404', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const b = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [tok] = await db
      .insert(schema.scimTokens)
      .values({
        workspaceId: a.workspaceId,
        tokenHash: 'k'.repeat(64),
        name: 't',
        scopes: [],
        createdBy: a.userId,
      })
      .returning({ id: schema.scimTokens.id });
    await actAs(b.userId, b.workspaceId);
    const { DELETE } = await import('@/app/api/admin/sso/scim-tokens/[tokenId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/admin/sso/scim-tokens/${tok!.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ tokenId: tok!.id }) },
    );
    expect(res.status).toBe(404);
  });
});
