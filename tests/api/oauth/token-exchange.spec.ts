/**
 * Plan F (MCP OAuth) — authorization-code → token exchange with PKCE.
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
import { hashOauthToken } from '@/lib/oauth/tokens';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

vi.mock('@/db/client', () => ({ getDb: () => db }));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const REDIRECT = 'http://localhost:33418/callback';
// RFC 7636 Appendix B verifier/challenge pair.
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

async function setup(scopes = ['mcp:read', 'pages:read']) {
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
  return { user: u, clientId: client.clientId, code };
}

async function exchange(fields: Record<string, string>): Promise<Response> {
  const { POST } = await import('@/app/api/oauth/token/route');
  return POST(
    new Request('http://localhost/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

describe('Plan F — token exchange', () => {
  it('authorization_code + valid code_verifier → access + refresh tokens', async () => {
    const { clientId, code, user } = await setup();
    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: VERIFIER,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token_type: string;
      expires_in: number;
      access_token: string;
      refresh_token: string;
      scope: string;
    };
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    expect(body.access_token.startsWith('cairn_oauth_')).toBe(true);
    expect(body.refresh_token.startsWith('cairn_oart_')).toBe(true);
    expect(body.scope).toContain('mcp:read');

    // persisted hashed, scoped to the granted workspace + scopes
    const rows = await db.select().from(schema.oauthTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accessTokenHash).toBe(hashOauthToken(body.access_token));
    expect(rows[0]?.refreshTokenHash).toBe(hashOauthToken(body.refresh_token));
    expect(rows[0]?.workspaceId).toBe(user.workspaceId);
    expect(rows[0]?.scopes).toContain('mcp:read');

    // audit oauth.token_issued
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'oauth.token_issued'));
    expect(audits).toHaveLength(1);
  });

  it('rejects a reused (already-consumed) code → invalid_grant, and revokes its tokens', async () => {
    const { clientId, code } = await setup();
    const first = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: VERIFIER,
    });
    expect(first.status).toBe(200);

    const second = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: VERIFIER,
    });
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe('invalid_grant');

    // replay defense: the token issued from the first exchange is revoked
    const rows = await db.select().from(schema.oauthTokens);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('rejects an expired code → invalid_grant', async () => {
    const { clientId, code } = await setup();
    // Force-expire the code.
    await db
      .update(schema.oauthAuthorizationCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.oauthAuthorizationCodes.codeHash, hashOauthToken(code)));

    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: VERIFIER,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('rejects a redirect_uri mismatch → invalid_grant', async () => {
    const { clientId, code } = await setup();
    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:33418/other',
      client_id: clientId,
      code_verifier: VERIFIER,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('rejects an unknown client_id → invalid_client', async () => {
    const { code } = await setup();
    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: 'nope',
      code_verifier: VERIFIER,
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('invalid_client');
  });
});
