// v0.10.0 G4 — client authentication on POST /api/oauth/revoke (RFC 7009
// §2.1), through the live server (the F1 lesson: /api/oauth is cookieless and
// must pass the proxy via PUBLIC_PATHS — every request here is session-free).
//
// Token strategy mirrors item-G3-token-family-revocation.spec.ts: register
// clients through the REAL unauthenticated /api/oauth/register endpoint, then
// seed oauth_tokens rows directly via postgres-js with known hashes
// (sha256-hex of the full plaintext, exactly how
// src/lib/oauth/tokens.ts#hashOauthToken stores them). The surface under test
// is POST /api/oauth/revoke alone.
//
// What this pins:
//   1. falsifiable core: ANONYMOUS revocation (token only, no client_id) is
//      401 and the row stays active — on the pre-G4 build this exact request
//      was a 200 that revoked the row;
//   2. confidential happy path: client_id + client_secret + own token → 200,
//      row revoked;
//   3. confidential wrong secret → 401, row untouched;
//   4. no-probe trap: public client A "revoking" client B's token gets the
//      same silent 200 as an unknown token, but B's row is NOT revoked —
//      200-without-action, never a validity oracle;
//   5. public client + own token → 200, revoked.
//
// The dev DB is persistent across specs — every seeded row (tokens, audit
// rows, client rows) is removed in finally; names/hashes are stamped per run.
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
function mintAccessToken(): string {
  return `cairn_oauth_${randomBytes(32).toString('base64url')}`;
}
function mintRefreshToken(): string {
  return `cairn_oart_${randomBytes(32).toString('base64url')}`;
}

/** Exactly hashOauthToken: sha256-hex of the FULL plaintext (prefix included). */
function sha256hex(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Register a PUBLIC client through the REAL unauthenticated endpoint. */
async function registerClientUnauthed(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/oauth/register', {
    data: {
      client_name: name,
      redirect_uris: ['https://example.invalid/g4/callback'],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

/**
 * Register a CONFIDENTIAL client (`token_endpoint_auth_method:
 * 'client_secret_post'`) — the register route returns the plaintext
 * `client_secret` exactly once; it is captured here and never logged.
 */
async function registerConfidentialClient(
  request: APIRequestContext,
  name: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const res = await request.post('/api/oauth/register', {
    data: {
      client_name: name,
      redirect_uris: ['https://example.invalid/g4/callback'],
      token_endpoint_auth_method: 'client_secret_post',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { client_id: string; client_secret: string };
  expect(body.client_secret).toMatch(/^cairn_ocs_/);
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

async function userIdByEmail(email: string): Promise<string> {
  return withSql(async (sql) => {
    const rows = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (rows.length === 0) throw new Error(`e2e harness: no user row for ${email}`);
    return (rows[0] as { id: string }).id;
  });
}

/**
 * Seed one ACTIVE token row. Returns the ACCESS plaintext (the secret a G4
 * revoke call presents) — the only place it ever lives; it is never logged.
 */
async function seedActiveToken(args: {
  clientId: string;
  userId: string;
  workspaceId: string;
}): Promise<string> {
  const access = mintAccessToken();
  await withSql(async (sql) => {
    await sql`
      INSERT INTO oauth_tokens
        (access_token_hash, refresh_token_hash, client_id, user_id, workspace_id,
         scopes, access_expires_at, refresh_expires_at, family_id)
      VALUES
        (${sha256hex(access)}, ${sha256hex(mintRefreshToken())}, ${args.clientId},
         ${args.userId}::uuid, ${args.workspaceId}::uuid, ${'{mcp:read}'}::text[],
         now() + interval '1 hour', now() + interval '30 days', ${randomUUID()}::uuid)
    `;
  });
  return access;
}

/** POST /api/oauth/revoke — cookieless, through the proxy (PUBLIC_PATHS). */
async function revokeCall(
  request: APIRequestContext,
  form: Record<string, string>,
): ReturnType<APIRequestContext['post']> {
  return request.post('/api/oauth/revoke', { form });
}

async function revokedAtByAccess(accessToken: string): Promise<unknown> {
  return withSql(async (sql) => {
    const rows = await sql`
      SELECT revoked_at FROM oauth_tokens
       WHERE access_token_hash = ${sha256hex(accessToken)}
    `;
    if (rows.length === 0) throw new Error('e2e harness: seeded token row vanished');
    return (rows[0] as { revoked_at: unknown }).revoked_at;
  });
}

/** Idempotent cleanup keyed by the per-test client(s). */
async function cleanupClients(clientIds: string[]): Promise<void> {
  await withSql(async (sql) => {
    for (const clientId of clientIds) {
      await sql`
        DELETE FROM audit_log
         WHERE action = 'oauth.token_revoked'
           AND target_id IN (SELECT id FROM oauth_tokens WHERE client_id = ${clientId})
      `;
      await sql`DELETE FROM oauth_tokens WHERE client_id = ${clientId}`;
      await sql`DELETE FROM oauth_clients WHERE client_id = ${clientId}`;
    }
  });
}

test.describe('item G4 — /api/oauth/revoke client authentication', () => {
  test('falsifiable core: anonymous revoke (token only) → 401 and the row stays active', async ({
    request,
    seeded,
  }) => {
    const clientId = await registerClientUnauthed(request, `g4-anon-${stamp()}`);
    try {
      const userId = await userIdByEmail(seeded.userEmail);
      const access = await seedActiveToken({
        clientId,
        userId,
        workspaceId: seeded.workspaceId,
      });

      // The pre-G4 build answered this exact request with 200 AND revoked the
      // row — RED on the old code, the whole point of the item.
      const res = await revokeCall(request, { token: access });
      expect(res.status(), 'anonymous revocation must be rejected').toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_client');

      expect(await revokedAtByAccess(access), 'row must still be active').toBeNull();
    } finally {
      await cleanupClients([clientId]);
    }
  });

  test('confidential happy path: client_id + secret + own token → 200, row revoked', async ({
    request,
    seeded,
  }) => {
    const { clientId, clientSecret } = await registerConfidentialClient(
      request,
      `g4-conf-${stamp()}`,
    );
    try {
      const userId = await userIdByEmail(seeded.userEmail);
      const access = await seedActiveToken({
        clientId,
        userId,
        workspaceId: seeded.workspaceId,
      });

      const res = await revokeCall(request, {
        token: access,
        client_id: clientId,
        client_secret: clientSecret,
      });
      expect(res.status(), await res.text().catch(() => '')).toBe(200);

      expect(await revokedAtByAccess(access), 'own token must be revoked').not.toBeNull();
    } finally {
      await cleanupClients([clientId]);
    }
  });

  test('confidential wrong secret → 401, row untouched', async ({ request, seeded }) => {
    const { clientId } = await registerConfidentialClient(request, `g4-wrong-${stamp()}`);
    try {
      const userId = await userIdByEmail(seeded.userEmail);
      const access = await seedActiveToken({
        clientId,
        userId,
        workspaceId: seeded.workspaceId,
      });

      const res = await revokeCall(request, {
        token: access,
        client_id: clientId,
        client_secret: 'cairn_ocs_definitely-not-the-secret',
      });
      expect(res.status()).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_client');

      expect(await revokedAtByAccess(access), 'row must be untouched').toBeNull();
    } finally {
      await cleanupClients([clientId]);
    }
  });

  test("no-probe trap: public client A revoking client B's token → silent 200, B's row NOT revoked", async ({
    request,
    seeded,
  }) => {
    const s = stamp();
    const clientA = await registerClientUnauthed(request, `g4-probe-a-${s}`);
    const clientB = await registerClientUnauthed(request, `g4-probe-b-${s}`);
    try {
      const userId = await userIdByEmail(seeded.userEmail);
      const accessB = await seedActiveToken({
        clientId: clientB,
        userId,
        workspaceId: seeded.workspaceId,
      });

      // Indistinguishable from an unknown token: 200, no body, NO action.
      const res = await revokeCall(request, { token: accessB, client_id: clientA });
      expect(res.status(), 'foreign token must be a silent 200').toBe(200);
      expect(await res.text()).toBe('');

      expect(await revokedAtByAccess(accessB), "B's row must still be active").toBeNull();
    } finally {
      await cleanupClients([clientA, clientB]);
    }
  });

  test('public client + own token → 200, revoked', async ({ request, seeded }) => {
    const clientId = await registerClientUnauthed(request, `g4-own-${stamp()}`);
    try {
      const userId = await userIdByEmail(seeded.userEmail);
      const access = await seedActiveToken({
        clientId,
        userId,
        workspaceId: seeded.workspaceId,
      });

      const res = await revokeCall(request, { token: access, client_id: clientId });
      expect(res.status(), await res.text().catch(() => '')).toBe(200);

      expect(await revokedAtByAccess(access), 'own token must be revoked').not.toBeNull();
    } finally {
      await cleanupClients([clientId]);
    }
  });
});
