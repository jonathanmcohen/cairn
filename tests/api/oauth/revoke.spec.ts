/**
 * Plan F (MCP OAuth) — RFC 7009 revocation.
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

async function issueTokens(): Promise<IssuedTokens> {
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
    scopes: ['mcp:read', 'pages:read'],
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
  });
  const tokens = await codeToTokens(db, {
    code,
    redirectUri: REDIRECT,
    clientId: client.clientId,
    codeVerifier: VERIFIER,
  });
  if ('kind' in tokens) throw new Error('exchange failed');
  return tokens;
}

async function revoke(token: string, hint?: string): Promise<Response> {
  const { POST } = await import('@/app/api/oauth/revoke/route');
  const fields: Record<string, string> = { token };
  if (hint) fields.token_type_hint = hint;
  return POST(
    new Request('http://localhost/api/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

describe('Plan F — token revocation', () => {
  it('revoking the access token sets revoked_at + writes oauth.token_revoked', async () => {
    const tokens = await issueTokens();
    const res = await revoke(tokens.accessToken, 'access_token');
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.accessTokenHash, hashOauthToken(tokens.accessToken)));
    expect(row?.revokedAt).not.toBeNull();

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'oauth.token_revoked'));
    expect(audits).toHaveLength(1);
  });

  it('revoking by the refresh-token hash also revokes the row', async () => {
    const tokens = await issueTokens();
    const res = await revoke(tokens.refreshToken, 'refresh_token');
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.refreshTokenHash, hashOauthToken(tokens.refreshToken)));
    expect(row?.revokedAt).not.toBeNull();
  });

  it('an unknown token → 200 and NO audit row (silent, RFC 7009)', async () => {
    const res = await revoke('cairn_oauth_not-a-real-token');
    expect(res.status).toBe(200);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'oauth.token_revoked'));
    expect(audits).toHaveLength(0);
  });

  it('revoke is idempotent (second revoke → 200, no extra audit row)', async () => {
    const tokens = await issueTokens();
    await revoke(tokens.accessToken);
    const second = await revoke(tokens.accessToken);
    expect(second.status).toBe(200);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'oauth.token_revoked'));
    // only the first real revocation wrote an audit row
    expect(audits).toHaveLength(1);
  });

  it('a revoked access token no longer resolves via resolveToken', async () => {
    const tokens = await issueTokens();
    await revoke(tokens.accessToken);
    const { resolveToken } = await import('@/lib/auth/token');
    const ctx = await resolveToken(`Bearer ${tokens.accessToken}`);
    expect(ctx).toBeNull();
  });
});
