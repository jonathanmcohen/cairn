/**
 * Plan F (MCP OAuth) — OAuth access tokens resolve + enforce scopes through the
 * SAME path as PATs (resolveToken + requireScope), and PAT resolution still works.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
import { requireScope, resolveToken } from '@/lib/auth/token';
import { hashOauthToken, mintOauthSecret, OAUTH_PREFIX } from '@/lib/oauth/tokens';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

vi.mock('@/db/client', () => ({ getDb: () => db }));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(32);
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE oauth_tokens, personal_access_tokens, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

/** Mint an OAuth access token row directly via the lib helpers + a raw insert. */
async function seedOauthToken(opts: {
  scopes: string[];
  accessExpiresAt?: Date;
  revoked?: boolean;
}): Promise<{ token: string; workspaceId: string; userId: string }> {
  const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
  const token = mintOauthSecret(OAUTH_PREFIX.accessToken);
  await db.insert(schema.oauthTokens).values({
    accessTokenHash: hashOauthToken(token),
    refreshTokenHash: hashOauthToken(mintOauthSecret(OAUTH_PREFIX.refreshToken)),
    clientId: 'client-abc',
    userId: u.userId,
    workspaceId: u.workspaceId,
    scopes: opts.scopes,
    accessExpiresAt: opts.accessExpiresAt ?? new Date(Date.now() + 3_600_000),
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    revokedAt: opts.revoked ? new Date() : null,
  });
  return { token, workspaceId: u.workspaceId, userId: u.userId };
}

describe('Plan F — scope enforcement', () => {
  it('resolves an OAuth access token as kind=oauth with its scopes', async () => {
    const { token, userId, workspaceId } = await seedOauthToken({
      scopes: ['mcp:read', 'pages:read'],
    });
    const ctx = await resolveToken(`Bearer ${token}`);
    expect(ctx).not.toBeNull();
    expect(ctx?.kind).toBe('oauth');
    expect(ctx?.userId).toBe(userId);
    expect(ctx?.workspaceId).toBe(workspaceId);
    expect(ctx?.scopes).toEqual(['mcp:read', 'pages:read']);
    expect(ctx?.mcpTools).toEqual([]);
  });

  it('requireScope passes for a granted scope and throws 403 for a missing one', async () => {
    const { token } = await seedOauthToken({ scopes: ['mcp:read', 'pages:read'] });
    const ctx = await resolveToken(`Bearer ${token}`);
    if (!ctx) throw new Error('expected ctx');
    expect(() => requireScope(ctx, 'pages:read')).not.toThrow();
    expect(() => requireScope(ctx, 'pages:write')).toThrow();
  });

  it('an admin-scoped token passes any requireScope (admin superset)', async () => {
    const { token } = await seedOauthToken({ scopes: ['admin'] });
    const ctx = await resolveToken(`Bearer ${token}`);
    if (!ctx) throw new Error('expected ctx');
    expect(() => requireScope(ctx, 'pages:destructive')).not.toThrow();
    expect(() => requireScope(ctx, 'databases:write')).not.toThrow();
  });

  it('an expired access token → resolveToken returns null', async () => {
    const { token } = await seedOauthToken({
      scopes: ['mcp:read'],
      accessExpiresAt: new Date(Date.now() - 1000),
    });
    expect(await resolveToken(`Bearer ${token}`)).toBeNull();
  });

  it('a revoked token → resolveToken returns null', async () => {
    const { token } = await seedOauthToken({ scopes: ['mcp:read'], revoked: true });
    expect(await resolveToken(`Bearer ${token}`)).toBeNull();
  });

  it('stamps last_used_at (fire-and-forget)', async () => {
    const { token } = await seedOauthToken({ scopes: ['mcp:read'] });
    await resolveToken(`Bearer ${token}`);
    // Give the fire-and-forget UPDATE a tick to land.
    await new Promise((r) => setTimeout(r, 50));
    const [row] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.accessTokenHash, hashOauthToken(token)));
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('regression: PATs still resolve as kind=pat', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'pat-regression',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
    });
    const ctx = await resolveToken(`Bearer ${token}`);
    expect(ctx?.kind).toBe('pat');
  });
});
