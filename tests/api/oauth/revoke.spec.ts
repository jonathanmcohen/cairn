/**
 * Plan F (MCP OAuth) — RFC 7009 revocation.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 *
 * v0.10.0 G4 — the endpoint now authenticates clients (RFC 7009 §2.1):
 * confidential clients present `client_secret` (form field, like /token);
 * public clients authenticate by client_id alone but can only revoke tokens
 * bound to their own client_id. A foreign token is a silent 200 WITHOUT
 * revocation (no-probe). Anonymous revocation → 401 invalid_client.
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

type Issued = {
  tokens: IssuedTokens;
  clientId: string;
  /** Plaintext secret for confidential clients, null for public ones. */
  clientSecret: string | null;
};

async function issueTokens(opts: { confidential?: boolean } = {}): Promise<Issued> {
  const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
  const { row: client, clientSecret } = await registerClient(db, {
    clientName: opts.confidential ? 'CI script' : 'Cursor',
    redirectUris: [REDIRECT],
    confidential: opts.confidential ?? false,
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
  return { tokens, clientId: client.clientId, clientSecret };
}

async function revoke(
  fields: Record<string, string | undefined>,
  hint?: string,
): Promise<Response> {
  const { POST } = await import('@/app/api/oauth/revoke/route');
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) body.set(k, v);
  }
  if (hint) body.set('token_type_hint', hint);
  return POST(
    new Request('http://localhost/api/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }),
  );
}

async function tokenRowByAccess(accessToken: string): Promise<schema.OauthToken | undefined> {
  const [row] = await db
    .select()
    .from(schema.oauthTokens)
    .where(eq(schema.oauthTokens.accessTokenHash, hashOauthToken(accessToken)));
  return row;
}

async function revokedAudits(): Promise<schema.AuditLogRow[]> {
  return db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'oauth.token_revoked'));
}

describe('Plan F — token revocation', () => {
  it('revoking the access token sets revoked_at + writes oauth.token_revoked', async () => {
    const { tokens, clientId } = await issueTokens();
    const res = await revoke({ token: tokens.accessToken, client_id: clientId }, 'access_token');
    expect(res.status).toBe(200);

    const row = await tokenRowByAccess(tokens.accessToken);
    expect(row?.revokedAt).not.toBeNull();

    expect(await revokedAudits()).toHaveLength(1);
  });

  it('revoking by the refresh-token hash also revokes the row', async () => {
    const { tokens, clientId } = await issueTokens();
    const res = await revoke({ token: tokens.refreshToken, client_id: clientId }, 'refresh_token');
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.refreshTokenHash, hashOauthToken(tokens.refreshToken)));
    expect(row?.revokedAt).not.toBeNull();
  });

  it('an unknown token, authenticated → 200 and NO audit row (silent, RFC 7009)', async () => {
    const { clientId } = await issueTokens();
    const res = await revoke({ token: 'cairn_oauth_not-a-real-token', client_id: clientId });
    expect(res.status).toBe(200);
    expect(await revokedAudits()).toHaveLength(0);
  });

  it('revoke is idempotent (second revoke → 200, no extra audit row)', async () => {
    const { tokens, clientId } = await issueTokens();
    await revoke({ token: tokens.accessToken, client_id: clientId });
    const second = await revoke({ token: tokens.accessToken, client_id: clientId });
    expect(second.status).toBe(200);
    // only the first real revocation wrote an audit row
    expect(await revokedAudits()).toHaveLength(1);
  });

  it('a revoked access token no longer resolves via resolveToken', async () => {
    const { tokens, clientId } = await issueTokens();
    await revoke({ token: tokens.accessToken, client_id: clientId });
    const { resolveToken } = await import('@/lib/auth/token');
    const ctx = await resolveToken(`Bearer ${tokens.accessToken}`);
    expect(ctx).toBeNull();
  });
});

describe('v0.10.0 G4 — client authentication (RFC 7009 §2.1)', () => {
  it('no client_id at all → 401 invalid_client, token NOT revoked', async () => {
    const { tokens } = await issueTokens();
    const res = await revoke({ token: tokens.accessToken });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client');

    const row = await tokenRowByAccess(tokens.accessToken);
    expect(row?.revokedAt).toBeNull();
    expect(await revokedAudits()).toHaveLength(0);
  });

  it('unknown client_id → 401 invalid_client, token NOT revoked', async () => {
    const { tokens } = await issueTokens();
    const res = await revoke({ token: tokens.accessToken, client_id: 'no-such-client' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client');
    expect((await tokenRowByAccess(tokens.accessToken))?.revokedAt).toBeNull();
  });

  it('confidential client + correct secret + own token → 200, revoked + audited', async () => {
    const { tokens, clientId, clientSecret } = await issueTokens({ confidential: true });
    expect(clientSecret).toMatch(/^cairn_ocs_/);
    const res = await revoke({
      token: tokens.accessToken,
      client_id: clientId,
      client_secret: clientSecret as string,
    });
    expect(res.status).toBe(200);
    expect((await tokenRowByAccess(tokens.accessToken))?.revokedAt).not.toBeNull();
    expect(await revokedAudits()).toHaveLength(1);
  });

  it('confidential client, MISSING secret → 401, token NOT revoked', async () => {
    const { tokens, clientId } = await issueTokens({ confidential: true });
    const res = await revoke({ token: tokens.accessToken, client_id: clientId });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client');
    expect((await tokenRowByAccess(tokens.accessToken))?.revokedAt).toBeNull();
    expect(await revokedAudits()).toHaveLength(0);
  });

  it('confidential client, WRONG secret → 401, token NOT revoked', async () => {
    const { tokens, clientId } = await issueTokens({ confidential: true });
    const res = await revoke({
      token: tokens.accessToken,
      client_id: clientId,
      client_secret: 'cairn_ocs_definitely-not-the-secret',
    });
    expect(res.status).toBe(401);
    expect((await tokenRowByAccess(tokens.accessToken))?.revokedAt).toBeNull();
  });

  it('public client + own token → 200, revoked (no secret expected)', async () => {
    const { tokens, clientId, clientSecret } = await issueTokens();
    expect(clientSecret).toBeNull();
    const res = await revoke({ token: tokens.accessToken, client_id: clientId });
    expect(res.status).toBe(200);
    expect((await tokenRowByAccess(tokens.accessToken))?.revokedAt).not.toBeNull();
  });

  it("public client + ANOTHER client's token → silent 200, token STILL ACTIVE (no-probe)", async () => {
    const victim = await issueTokens();
    const attacker = await issueTokens();
    expect(attacker.clientId).not.toBe(victim.clientId);

    const res = await revoke({
      token: victim.tokens.accessToken,
      client_id: attacker.clientId,
    });
    // The information-disclosure trap: 200 (never reveal the token exists)
    // but WITHOUT action — the victim's token must remain fully alive.
    expect(res.status).toBe(200);
    expect((await tokenRowByAccess(victim.tokens.accessToken))?.revokedAt).toBeNull();
    expect(await revokedAudits()).toHaveLength(0);

    // Still resolves — the foreign revoke had no effect at all.
    const { resolveToken } = await import('@/lib/auth/token');
    const ctx = await resolveToken(`Bearer ${victim.tokens.accessToken}`);
    expect(ctx).not.toBeNull();
  });

  it('malformed body (no fields) → 401 before any no-probe handling', async () => {
    const { POST } = await import('@/app/api/oauth/revoke/route');
    const res = await POST(
      new Request('http://localhost/api/oauth/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'not&really=valid%ZZ',
      }),
    );
    // Whatever URLSearchParams salvages, there is no client_id → auth fails.
    expect(res.status).toBe(401);
  });
});
