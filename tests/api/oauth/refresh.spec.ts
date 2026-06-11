/**
 * Plan F (MCP OAuth) — refresh-token grant with rotation.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { randomUUID } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { registerClient } from '@/lib/oauth/clients';
import { issueAuthCode } from '@/lib/oauth/codes';
import {
  codeToTokens,
  type ExchangeError,
  type IssuedTokens,
  refreshTokens,
} from '@/lib/oauth/exchange';
import { hashOauthToken, mintOauthSecret, OAUTH_PREFIX } from '@/lib/oauth/tokens';
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

// v0.10.0 G3 — refresh-token family revocation on reuse. A replayed
// (already-rotated) refresh token names its rotation chain via family_id and
// burns the whole chain; siblings (other grants, even for the same
// user+client+workspace) are untouched.
describe('item G3 — refresh-token family revocation on reuse', () => {
  const REUSE_DESCRIPTION = 'refresh token reuse detected; token family revoked';

  async function familyRevokedAudits() {
    return db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'oauth.token_family_revoked'));
  }

  it('rotate A→B→C then replay A: reuse named, B AND C revoked, audit row written', async () => {
    const { clientId, tokens } = await issueInitialTokens();

    const resB = await refresh({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    expect(resB.status).toBe(200);
    const b = (await resB.json()) as { refresh_token: string };

    const resC = await refresh({
      grant_type: 'refresh_token',
      refresh_token: b.refresh_token,
      client_id: clientId,
    });
    expect(resC.status).toBe(200);

    // Replay A (revoked by the first rotation) → reuse detected.
    const replay = await refresh({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    expect(replay.status).toBe(400);
    const replayBody = (await replay.json()) as { error: string; error_description: string };
    expect(replayBody.error).toBe('invalid_grant');
    expect(replayBody.error_description).toBe(REUSE_DESCRIPTION);

    // A, B and C all share one family — and EVERY row is now revoked.
    const rows = await db.select().from(schema.oauthTokens);
    expect(rows.length).toBe(3);
    expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
    for (const row of rows) {
      expect(row.revokedAt).not.toBeNull();
    }

    // Exactly one reuse audit, naming refresh reuse + the family — no secrets.
    const audits = await familyRevokedAudits();
    expect(audits.length).toBe(1);
    const meta = audits[0]?.metadata as Record<string, unknown>;
    expect(meta.reason).toBe('refresh_token_reuse');
    expect(meta.familyId).toBe(rows[0]?.familyId);
    expect(meta.clientId).toBe(clientId);
  });

  it('legitimate single rotation: family NOT revoked, new token active, no reuse audit', async () => {
    const { clientId, tokens } = await issueInitialTokens();
    const res = await refresh({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    expect(res.status).toBe(200);

    const active = await db
      .select()
      .from(schema.oauthTokens)
      .where(isNull(schema.oauthTokens.revokedAt));
    expect(active.length).toBe(1); // the freshly rotated pair, same family
    expect((await familyRevokedAudits()).length).toBe(0);
  });

  it('two grants for the same user+client+workspace get DIFFERENT families; reuse in one leaves the other live', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { row: client } = await registerClient(db, {
      clientName: 'Cursor',
      redirectUris: [REDIRECT],
      confidential: false,
    });
    const issue = async (): Promise<IssuedTokens> => {
      const { code } = await issueAuthCode(db, {
        clientId: client.clientId,
        clientName: client.clientName,
        userId: u.userId,
        workspaceId: u.workspaceId,
        scopes: ['mcp:read'],
        redirectUri: REDIRECT,
        codeChallenge: CHALLENGE,
      });
      const t = await codeToTokens(db, {
        code,
        redirectUri: REDIRECT,
        clientId: client.clientId,
        codeVerifier: VERIFIER,
      });
      if ('kind' in t) throw new Error(`exchange failed: ${t.description}`);
      return t;
    };

    const grant1 = await issue();
    const grant2 = await issue();
    // The code exchange omits familyId → DB default → fresh family per grant.
    expect(grant1.row.familyId).not.toBe(grant2.row.familyId);

    // Rotate grant1 then replay its original token → reuse in family 1.
    const rotated = await refresh({
      grant_type: 'refresh_token',
      refresh_token: grant1.refreshToken,
      client_id: client.clientId,
    });
    expect(rotated.status).toBe(200);
    const replay = await refresh({
      grant_type: 'refresh_token',
      refresh_token: grant1.refreshToken,
      client_id: client.clientId,
    });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error_description: string }).error_description).toBe(
      REUSE_DESCRIPTION,
    );

    // Family 1 fully dead, family 2 untouched and still rotates fine.
    const family1 = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.familyId, grant1.row.familyId));
    expect(family1.length).toBe(2);
    for (const row of family1) expect(row.revokedAt).not.toBeNull();

    const grant2Refresh = await refresh({
      grant_type: 'refresh_token',
      refresh_token: grant2.refreshToken,
      client_id: client.clientId,
    });
    expect(grant2Refresh.status).toBe(200);
  });

  it('backfill semantics: seeded rows with explicit distinct family_ids stay isolated on reuse', async () => {
    // Simulates post-0073 backfilled rows: every pre-existing row got its OWN
    // family, so a reuse in one never touches the other.
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { row: client } = await registerClient(db, {
      clientName: 'Cursor',
      redirectUris: [REDIRECT],
      confidential: false,
    });
    const family1 = randomUUID();
    const family2 = randomUUID();
    const refreshA = mintOauthSecret(OAUTH_PREFIX.refreshToken); // family 1, already rotated
    const refreshA2 = mintOauthSecret(OAUTH_PREFIX.refreshToken); // family 1, active descendant
    const refreshB = mintOauthSecret(OAUTH_PREFIX.refreshToken); // family 2, active
    const base = {
      clientId: client.clientId,
      userId: u.userId,
      workspaceId: u.workspaceId,
      scopes: ['mcp:read'],
      accessExpiresAt: new Date(Date.now() + 3_600_000),
      refreshExpiresAt: new Date(Date.now() + 86_400_000),
    };
    await db.insert(schema.oauthTokens).values([
      {
        ...base,
        accessTokenHash: hashOauthToken(mintOauthSecret(OAUTH_PREFIX.accessToken)),
        refreshTokenHash: hashOauthToken(refreshA),
        familyId: family1,
        revokedAt: new Date(),
      },
      {
        ...base,
        accessTokenHash: hashOauthToken(mintOauthSecret(OAUTH_PREFIX.accessToken)),
        refreshTokenHash: hashOauthToken(refreshA2),
        familyId: family1,
      },
      {
        ...base,
        accessTokenHash: hashOauthToken(mintOauthSecret(OAUTH_PREFIX.accessToken)),
        refreshTokenHash: hashOauthToken(refreshB),
        familyId: family2,
      },
    ]);

    // Present the rotated family-1 token → reuse: ALL of family 1 dies.
    const replay = await refresh({
      grant_type: 'refresh_token',
      refresh_token: refreshA,
      client_id: client.clientId,
    });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error_description: string }).error_description).toBe(
      REUSE_DESCRIPTION,
    );

    const f1Active = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.familyId, family1))
      .then((rows) => rows.filter((r) => r.revokedAt === null));
    expect(f1Active.length).toBe(0);

    // Family 2 untouched: its token still rotates.
    const f2Refresh = await refresh({
      grant_type: 'refresh_token',
      refresh_token: refreshB,
      client_id: client.clientId,
    });
    expect(f2Refresh.status).toBe(200);
  });

  it('concurrent replay race: one winner, the loser revokes the whole family (conservative)', async () => {
    const { clientId, tokens } = await issueInitialTokens();

    // Two requests racing the SAME refresh token. The loser either sees the
    // row already revoked (reuse branch) or loses the guarded UPDATE (race
    // branch) — both are pinned to the same family-revoke response, which
    // also burns the winner's freshly minted pair.
    const [r1, r2] = await Promise.all([
      refreshTokens(db, { refreshToken: tokens.refreshToken, clientId }),
      refreshTokens(db, { refreshToken: tokens.refreshToken, clientId }),
    ]);
    const results = [r1, r2];
    const winners = results.filter((r) => !('kind' in r));
    const losers = results.filter((r) => 'kind' in r) as ExchangeError[];
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0]?.kind).toBe('invalid_grant');
    expect(losers[0]?.description).toBe(REUSE_DESCRIPTION);

    // Every row in the family is revoked — including the winner's new pair.
    const rows = await db.select().from(schema.oauthTokens);
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.revokedAt).not.toBeNull();

    const audits = await familyRevokedAudits();
    expect(audits.length).toBe(1);
    expect((audits[0]?.metadata as Record<string, unknown>).reason).toBe('refresh_token_reuse');
  });
});
