// v0.10.0 G3 — refresh-token FAMILY revocation on reuse, through the live
// server (the F1 lesson: /api/oauth is cookieless and must pass the proxy via
// PUBLIC_PATHS — every request here is deliberately session-free).
//
// Token strategy: driving the full OAuth dance (authorize → consent → code →
// token) per test is heavy and already runtime-covered by
// item-F-mcp-oauth-flow.spec.ts. Instead this spec follows the D3 pattern:
// register a client through the REAL unauthenticated /api/oauth/register
// endpoint, then seed oauth_tokens rows directly via postgres-js with known
// refresh hashes — sha256-hex of the full plaintext, exactly how
// src/lib/oauth/tokens.ts#hashOauthToken stores them — and explicit
// family_ids (what migration 0073's backfill produces). The surface under
// test is POST /api/oauth/token (grant_type=refresh_token) alone.
//
// What this pins:
//   1. falsifiable core: rotate A'→B→C, replay A' → invalid_grant naming
//      reuse AND every row in the family (B's and C's included) is revoked;
//   2. no false positive: a single legitimate refresh leaves exactly one
//      active row and writes no reuse audit;
//   3. family isolation: reuse in family 1 leaves family 2 (same user+client)
//      refreshing 200 — the backfill "own family per row" contract;
//   4. audit: oauth.token_family_revoked with metadata.reason naming refresh
//      reuse — and never any token material.
//
// The dev DB is persistent across specs — every seeded row (tokens, client,
// audit rows) is removed in finally; names/hashes are stamped per run.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import postgres from 'postgres';
import { expect, test } from '../a11y/fixtures';

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  const sql = postgres(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function stamp(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Mint plausible plaintexts with the real prefixes (src/lib/oauth/tokens.ts). */
function mintRefreshToken(): string {
  return `cairn_oart_${randomBytes(32).toString('base64url')}`;
}
function mintAccessToken(): string {
  return `cairn_oauth_${randomBytes(32).toString('base64url')}`;
}

/** Exactly hashOauthToken: sha256-hex of the FULL plaintext (prefix included). */
function sha256hex(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Register a client through the REAL unauthenticated endpoint (no cookies). */
async function registerClientUnauthed(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/oauth/register', {
    data: {
      client_name: name,
      redirect_uris: ['https://example.invalid/g3/callback'],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function userIdByEmail(email: string): Promise<string> {
  return withSql(async (sql) => {
    const rows = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (rows.length === 0) throw new Error(`e2e harness: no user row for ${email}`);
    return (rows[0] as { id: string }).id;
  });
}

/**
 * Seed one ACTIVE token row with an explicit family_id (what a post-0073
 * backfilled or freshly granted row looks like). Returns the refresh
 * plaintext — the only place it ever lives; it is never logged.
 */
async function seedActiveToken(args: {
  clientId: string;
  userId: string;
  workspaceId: string;
  familyId: string;
}): Promise<string> {
  const refresh = mintRefreshToken();
  await withSql(async (sql) => {
    await sql`
      INSERT INTO oauth_tokens
        (access_token_hash, refresh_token_hash, client_id, user_id, workspace_id,
         scopes, access_expires_at, refresh_expires_at, family_id)
      VALUES
        (${sha256hex(mintAccessToken())}, ${sha256hex(refresh)}, ${args.clientId},
         ${args.userId}::uuid, ${args.workspaceId}::uuid, ${'{mcp:read}'}::text[],
         now() + interval '1 hour', now() + interval '30 days', ${args.familyId}::uuid)
    `;
  });
  return refresh;
}

/** POST /api/oauth/token — cookieless, through the proxy (PUBLIC_PATHS). */
async function refreshGrant(request: APIRequestContext, refreshToken: string, clientId: string) {
  return request.post('/api/oauth/token', {
    form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
  });
}

async function familyRows(familyId: string): Promise<Array<{ id: string; revoked_at: unknown }>> {
  return withSql(async (sql) => {
    const rows = await sql`
      SELECT id, revoked_at FROM oauth_tokens WHERE family_id = ${familyId}::uuid
    `;
    return rows as unknown as Array<{ id: string; revoked_at: unknown }>;
  });
}

async function reuseAudits(familyId: string): Promise<Array<Record<string, unknown>>> {
  return withSql(async (sql) => {
    const rows = await sql`
      SELECT metadata FROM audit_log
       WHERE action = 'oauth.token_family_revoked' AND metadata->>'familyId' = ${familyId}
    `;
    return rows.map((r) => (r as { metadata: Record<string, unknown> }).metadata);
  });
}

/**
 * Idempotent cleanup keyed by the per-test client: audit rows first (the
 * token_issued rows target this client's token ids; the family-revoked rows
 * carry its clientId in metadata), then tokens, then the client row.
 */
async function cleanupClient(clientId: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      DELETE FROM audit_log
       WHERE (action = 'oauth.token_issued'
              AND target_id IN (SELECT id FROM oauth_tokens WHERE client_id = ${clientId}))
          OR (action = 'oauth.token_family_revoked' AND metadata->>'clientId' = ${clientId})
    `;
    await sql`DELETE FROM oauth_tokens WHERE client_id = ${clientId}`;
    await sql`DELETE FROM oauth_clients WHERE client_id = ${clientId}`;
  });
}

test.describe('item G3 — refresh-token family revocation on reuse', () => {
  test('falsifiable core: rotate A→B→C, replay A → reuse named and EVERY family row revoked', async ({
    request,
    seeded,
  }) => {
    const clientId = await registerClientUnauthed(request, `g3-core-${stamp()}`);
    try {
      const userId = await userIdByEmail(seeded.userEmail);
      const familyId = randomUUID();
      const tokenA = await seedActiveToken({
        clientId,
        userId,
        workspaceId: seeded.workspaceId,
        familyId,
      });

      // A → B and B → C: rotation works and stays inside the seeded family.
      const resB = await refreshGrant(request, tokenA, clientId);
      expect(resB.status(), await resB.text().catch(() => '')).toBe(200);
      const b = (await resB.json()) as { refresh_token: string };
      expect(b.refresh_token).toMatch(/^cairn_oart_/);

      const resC = await refreshGrant(request, b.refresh_token, clientId);
      expect(resC.status(), await resC.text().catch(() => '')).toBe(200);

      // Replay A (revoked by the first rotation) → reuse detected, named.
      const replay = await refreshGrant(request, tokenA, clientId);
      expect(replay.status()).toBe(400);
      const body = (await replay.json()) as { error: string; error_description: string };
      expect(body.error).toBe('invalid_grant');
      expect(body.error_description).toBe('refresh token reuse detected; token family revoked');

      // The falsifiable bit: B's AND C's rows are dead too, not just A's.
      const rows = await familyRows(familyId);
      expect(rows.length).toBe(3);
      for (const row of rows) {
        expect(row.revoked_at, `family row ${row.id} must be revoked`).not.toBeNull();
      }
    } finally {
      await cleanupClient(clientId);
    }
  });

  test('no false positive: a single legitimate refresh leaves one active row and no reuse audit', async ({
    request,
    seeded,
  }) => {
    const clientId = await registerClientUnauthed(request, `g3-clean-${stamp()}`);
    try {
      const userId = await userIdByEmail(seeded.userEmail);
      const familyId = randomUUID();
      const token = await seedActiveToken({
        clientId,
        userId,
        workspaceId: seeded.workspaceId,
        familyId,
      });

      const res = await refreshGrant(request, token, clientId);
      expect(res.status(), await res.text().catch(() => '')).toBe(200);

      // Two rows in the family (old + rotated), exactly ONE still active.
      const rows = await familyRows(familyId);
      expect(rows.length).toBe(2);
      expect(rows.filter((r) => r.revoked_at === null).length).toBe(1);

      expect((await reuseAudits(familyId)).length).toBe(0);
    } finally {
      await cleanupClient(clientId);
    }
  });

  test('family isolation: reuse in family 1 leaves family 2 (same user+client) refreshing fine', async ({
    request,
    seeded,
  }) => {
    const clientId = await registerClientUnauthed(request, `g3-isolate-${stamp()}`);
    try {
      const userId = await userIdByEmail(seeded.userEmail);
      const family1 = randomUUID();
      const family2 = randomUUID();
      const token1 = await seedActiveToken({
        clientId,
        userId,
        workspaceId: seeded.workspaceId,
        familyId: family1,
      });
      const token2 = await seedActiveToken({
        clientId,
        userId,
        workspaceId: seeded.workspaceId,
        familyId: family2,
      });

      // Trigger reuse in family 1: rotate, then replay the original.
      const rotated = await refreshGrant(request, token1, clientId);
      expect(rotated.status(), await rotated.text().catch(() => '')).toBe(200);
      const replay = await refreshGrant(request, token1, clientId);
      expect(replay.status()).toBe(400);

      const f1 = await familyRows(family1);
      expect(f1.filter((r) => r.revoked_at === null).length).toBe(0);

      // Family 2's seeded token is untouched and still rotates 200.
      const res2 = await refreshGrant(request, token2, clientId);
      expect(res2.status(), await res2.text().catch(() => '')).toBe(200);
      const f2 = await familyRows(family2);
      expect(f2.filter((r) => r.revoked_at === null).length).toBe(1);
    } finally {
      await cleanupClient(clientId);
    }
  });

  test('audit: reuse writes oauth.token_family_revoked naming refresh reuse, no token material', async ({
    request,
    seeded,
  }) => {
    const clientId = await registerClientUnauthed(request, `g3-audit-${stamp()}`);
    try {
      const userId = await userIdByEmail(seeded.userEmail);
      const familyId = randomUUID();
      const token = await seedActiveToken({
        clientId,
        userId,
        workspaceId: seeded.workspaceId,
        familyId,
      });

      const rotated = await refreshGrant(request, token, clientId);
      expect(rotated.status(), await rotated.text().catch(() => '')).toBe(200);
      const replay = await refreshGrant(request, token, clientId);
      expect(replay.status()).toBe(400);

      const audits = await reuseAudits(familyId);
      expect(audits.length).toBe(1);
      const meta = audits[0] as Record<string, unknown>;
      expect(meta.reason).toBe('refresh_token_reuse');
      expect(meta.familyId).toBe(familyId);
      expect(meta.clientId).toBe(clientId);
      // Ids only — the seeded plaintext (or any cairn_oart_ material) must
      // never appear in operator-visible metadata.
      const serialized = JSON.stringify(meta);
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain('cairn_oart_');
    } finally {
      await cleanupClient(clientId);
    }
  });
});
