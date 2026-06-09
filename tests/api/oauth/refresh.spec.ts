/**
 * Plan F (MCP OAuth) — refresh-token grant with rotation.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { registerClient } from '@/lib/oauth/clients';
import { issueAuthCode } from '@/lib/oauth/codes';
import { codeToTokens, type IssuedTokens } from '@/lib/oauth/exchange';
import { hashOauthToken } from '@/lib/oauth/tokens';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

vi.mock('@/db/client', () => ({ getDb: () => db }));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const REDIRECT = 'http://localhost:33418/callback';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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
  await sql`TRUNCATE oauth_tokens, oauth_authorization_codes, oauth_clients, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function issueInitialTokens(scopes = ['mcp:read', 'pages:read']): Promise<{
  clientId: string;
  tokens: IssuedTokens;
}> {
  const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
  const { row: client } = await registerClient(db, {
    clientName: 'Cursor',
    redirectUris: [REDIRECT],
    confidential: false,
  });
  const { code } = await issueAuthCode(db, {
    clientId: client.clientId,
    clientName: client.clientName,
    userId: u.userId,
    workspaceId: u.workspaceId,
    scopes,
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
  });
  const tokens = await codeToTokens(db, {
    code,
    redirectUri: REDIRECT,
    clientId: client.clientId,
    codeVerifier: VERIFIER,
  });
  if ('kind' in tokens) throw new Error('initial exchange failed');
  return { clientId: client.clientId, tokens };
}

async function refresh(fields: Record<string, string>): Promise<Response> {
  const { POST } = await import('@/app/api/oauth/token/route');
  return POST(
    new Request('http://localhost/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

describe('Plan F — refresh token', () => {
  it('refresh_token grant → new access + new refresh (rotation); old refresh revoked', async () => {
    const { clientId, tokens } = await issueInitialTokens();
    const res = await refresh({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    expect(body.access_token).not.toBe(tokens.accessToken);
    expect(body.refresh_token).not.toBe(tokens.refreshToken);
    expect(body.refresh_token.startsWith('cairn_oart_')).toBe(true);

    // The OLD token row (matched by its refresh hash) is now revoked.
    const [oldRow] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.refreshTokenHash, hashOauthToken(tokens.refreshToken)));
    expect(oldRow?.revokedAt).not.toBeNull();

    // A second use of the old refresh token → invalid_grant.
    const replay = await refresh({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe('invalid_grant');
  });

  it('issued scopes are ≤ the original grant (no escalation)', async () => {
    const { clientId, tokens } = await issueInitialTokens(['mcp:read', 'pages:read']);
    const res = await refresh({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    const body = (await res.json()) as { scope: string };
    const scopes = body.scope.split(' ');
    expect(scopes.sort()).toEqual(['mcp:read', 'pages:read']);
    expect(scopes).not.toContain('admin');
  });

  it('a revoked refresh token → invalid_grant', async () => {
    const { clientId, tokens } = await issueInitialTokens();
    await db
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.oauthTokens.refreshTokenHash, hashOauthToken(tokens.refreshToken)));
    const res = await refresh({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('an expired refresh token → invalid_grant', async () => {
    const { clientId, tokens } = await issueInitialTokens();
    await db
      .update(schema.oauthTokens)
      .set({ refreshExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.oauthTokens.refreshTokenHash, hashOauthToken(tokens.refreshToken)));
    const res = await refresh({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('writes an oauth.token_issued audit on each refresh', async () => {
    const { clientId, tokens } = await issueInitialTokens();
    await refresh({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'oauth.token_issued'));
    // one for the initial exchange + one for the refresh
    expect(audits.length).toBe(2);
  });
});
