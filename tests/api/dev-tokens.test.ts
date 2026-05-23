import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let active: { name: string; value: string } | undefined;

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
  cookies: async () => ({ get: () => active, set: () => {} }),
}));

async function actAs(userId: string | null, workspaceId?: string): Promise<void> {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
  active = workspaceId ? { name: 'cairn_ws', value: workspaceId } : undefined;
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE personal_access_tokens, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  active = undefined;
});

describe('POST /api/dev/tokens', () => {
  it('returns the plaintext token ONCE on creation; subsequent GET never re-surfaces it', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId, u.workspaceId);

    const { POST, GET } = await import('@/app/api/dev/tokens/route');
    const req = new Request('http://localhost/api/dev/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'CI bot',
        scopes: ['pages:read', 'pages:write'],
        mcpTools: ['pages.read'],
        expiresInDays: 30,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; row: { id: string; tokenPrefix: string } };
    expect(body.token.startsWith('cairn_pat_')).toBe(true);
    expect(body.row.tokenPrefix.startsWith('cairn_pat_')).toBe(true);

    // GET must not include the plaintext anywhere.
    const listRes = await GET();
    const listBody = JSON.stringify(await listRes.json());
    expect(listBody).not.toContain(body.token);
    expect(listBody).not.toContain('tokenHash');
    expect(listBody).not.toContain('token_hash');
  });

  it('returns 401 when unauthenticated', async () => {
    const { POST } = await import('@/app/api/dev/tokens/route');
    await actAs(null);

    const req = new Request('http://localhost/api/dev/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', scopes: ['pages:read'], mcpTools: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects invalid scopes with 400', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId, u.workspaceId);
    const { POST } = await import('@/app/api/dev/tokens/route');
    const req = new Request('http://localhost/api/dev/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 't', scopes: ['not-a-real-scope'], mcpTools: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/dev/tokens', () => {
  it("only lists the requesting user's tokens (cross-user invisible)", async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'editor', email: 'a@x.com' });
    const b = await createTestWorkspaceWithUser(db, { role: 'editor', email: 'b@x.com' });

    // Mint one PAT as a, one as b.
    await actAs(a.userId, a.workspaceId);
    const { POST, GET } = await import('@/app/api/dev/tokens/route');
    const mkReq = (name: string) =>
      new Request('http://localhost/api/dev/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, scopes: ['pages:read'], mcpTools: [] }),
      });
    await POST(mkReq('a-token'));

    await actAs(b.userId, b.workspaceId);
    await POST(mkReq('b-token'));

    // b sees only b's token.
    const res = await GET();
    const body = (await res.json()) as { tokens: { name: string }[] };
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]?.name).toBe('b-token');
  });

  it('omits revoked tokens from the default list', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId, u.workspaceId);
    const { POST, GET } = await import('@/app/api/dev/tokens/route');
    const mintRes = await POST(
      new Request('http://localhost/api/dev/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 't', scopes: ['pages:read'], mcpTools: [] }),
      }),
    );
    const minted = (await mintRes.json()) as { row: { id: string } };
    await sql`UPDATE personal_access_tokens SET revoked_at = now() WHERE id = ${minted.row.id}`;

    const listRes = await GET();
    const body = (await listRes.json()) as { tokens: { id: string }[] };
    expect(body.tokens).toHaveLength(0);
  });
});

describe('DELETE /api/dev/tokens/[tokenId]', () => {
  it('soft-revokes the token (sets revoked_at; row stays in DB)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId, u.workspaceId);
    const { POST } = await import('@/app/api/dev/tokens/route');
    const mintRes = await POST(
      new Request('http://localhost/api/dev/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 't', scopes: ['pages:read'], mcpTools: [] }),
      }),
    );
    const minted = (await mintRes.json()) as { row: { id: string } };

    const { DELETE } = await import('@/app/api/dev/tokens/[tokenId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/dev/tokens/${minted.row.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ tokenId: minted.row.id }) },
    );
    expect(res.status).toBe(204);

    // Row still exists in DB (soft delete).
    const [row] = await db
      .select()
      .from(schema.personalAccessTokens)
      .where(eq(schema.personalAccessTokens.id, minted.row.id))
      .limit(1);
    expect(row).toBeDefined();
    expect(row?.revokedAt).not.toBeNull();
  });

  it('writes a pat.revoked audit row in the same transaction', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId, u.workspaceId);
    const { POST } = await import('@/app/api/dev/tokens/route');
    const mintRes = await POST(
      new Request('http://localhost/api/dev/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'CI bot', scopes: ['pages:read'], mcpTools: [] }),
      }),
    );
    const minted = (await mintRes.json()) as { row: { id: string } };

    const { DELETE } = await import('@/app/api/dev/tokens/[tokenId]/route');
    await DELETE(
      new Request(`http://localhost/api/dev/tokens/${minted.row.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ tokenId: minted.row.id }) },
    );

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, minted.row.id))
      .orderBy(schema.auditLog.createdAt);
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('pat.created');
    expect(actions).toContain('pat.revoked');
  });

  it("returns 404 when revoking another user's token (no existence leak)", async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'editor', email: 'a@x.com' });
    const b = await createTestWorkspaceWithUser(db, { role: 'editor', email: 'b@x.com' });

    // a mints; b tries to revoke.
    await actAs(a.userId, a.workspaceId);
    const { POST } = await import('@/app/api/dev/tokens/route');
    const mintRes = await POST(
      new Request('http://localhost/api/dev/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'a-token', scopes: ['pages:read'], mcpTools: [] }),
      }),
    );
    const minted = (await mintRes.json()) as { row: { id: string } };

    await actAs(b.userId, b.workspaceId);
    const { DELETE } = await import('@/app/api/dev/tokens/[tokenId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/dev/tokens/${minted.row.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ tokenId: minted.row.id }) },
    );
    expect(res.status).toBe(404);

    // a's token must still be live in the DB (b's failed revoke didn't mutate).
    const [row] = await db
      .select()
      .from(schema.personalAccessTokens)
      .where(eq(schema.personalAccessTokens.id, minted.row.id))
      .limit(1);
    expect(row?.revokedAt).toBeNull();
  });
});
