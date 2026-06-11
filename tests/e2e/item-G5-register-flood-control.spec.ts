// v0.10.0 G5 — flood control on POST /api/oauth/register (rate limit + admin
// registration lock), through the live server (the F1 lesson: /api/oauth is
// cookieless and must pass the proxy via PUBLIC_PATHS — register calls here
// use the cookieless `request` fixture; only the admin lock mutation rides
// the signed-in page context).
//
// What this pins:
//   1. lock flow: admin locks registration via the G5 admin route and
//      captures the ONE-TIME initial access token from the response;
//      a cookieless register WITHOUT a bearer ⇒ 401 invalid_token; WITH the
//      captured bearer ⇒ 201 (RFC 7591 §3.1.1);
//   2. default open: with the lock off a single register ⇒ 201 — the
//      zero-setup MCP self-registration posture stays the default;
//   3. falsifiable core (burst): valid registrations from one source burst
//      until a 429 with a parseable positive-integer Retry-After arrives
//      (≤35 attempts); every response before it was 201; throttled requests
//      write no oauth_clients row.
//
// ORDERING IS LOAD-BEARING. The limiter buckets live in-process on the booted
// server and survive between tests (reuseExistingServer), and a spec cannot
// set server env. So the burst test — which exhausts the shared bucket — runs
// LAST in this file, and this file sorts last among the client-registering
// specs (item-D3 < item-F < item-G3 < item-G4 < item-G5, serial single
// worker), so their handful of registrations per run (~2-5 each, against a
// 10/min-per-IP refill) never see G5's exhausted bucket.
//
// Per-IP key isolation (two sources, one exhausted, the other unaffected) is
// NOT testable here: the harness boots the server WITHOUT TRUST_PROXY (see
// playwright.e2e.config.ts / .env), so clientIp() ignores x-forwarded-for and
// every caller shares the literal 'unknown' key — spoofed headers cannot
// simulate distinct sources. That isolation (and the global-vs-ip bucket
// split) is unit-covered in tests/lib/oauth/register-rate-limit.test.ts and
// tests/api/oauth/register-flood-control.spec.ts, which drive TRUST_PROXY
// explicitly.
//
// The dev DB is persistent across runs: every client this spec registers is
// tracked and deleted in finally, lock state is removed belt-and-braces via
// direct system_meta deletes, and oauth.register_lock_changed audit rows for
// the seeded workspace are purged.
import type { APIRequestContext } from '@playwright/test';
import postgres from 'postgres';
import { expect, signIn, test } from '../a11y/fixtures';

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

async function deleteClients(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  await withSql(async (sql) => {
    for (const id of clientIds) {
      await sql`DELETE FROM oauth_clients WHERE client_id = ${id}`;
    }
  });
}

/** Belt-and-braces: force the lock OFF at the DB level + purge its audit rows. */
async function removeLockState(workspaceId: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM system_meta WHERE key IN ('oauth.register_lock', 'oauth.register_iat_hash')`;
    await sql`
      DELETE FROM audit_log
      WHERE action = 'oauth.register_lock_changed'
        AND workspace_id = ${workspaceId}::uuid`;
  });
}

type RegisterArgs = { name: string; bearer?: string };

/** Cookieless register through the REAL endpoint (unique valid body per call). */
async function registerRaw(request: APIRequestContext, args: RegisterArgs) {
  return request.post('/api/oauth/register', {
    headers: args.bearer ? { authorization: `Bearer ${args.bearer}` } : {},
    data: {
      client_name: args.name,
      redirect_uris: ['https://example.invalid/g5/callback'],
      token_endpoint_auth_method: 'none',
    },
  });
}

// ---------------------------------------------------------------------------
// 1. Lock flow — runs FIRST (see the ordering note above): it needs working
//    rate-limit headroom and must leave the instance unlocked for the rest.
// ---------------------------------------------------------------------------
test('registration lock: admin locks, 401 without bearer, 201 with the one-time token', async ({
  page,
  request,
  seeded,
}) => {
  const run = stamp();
  const registered: string[] = [];
  await signIn(page, seeded);
  try {
    // Enable the lock via the admin mutation surface (the API the UI card
    // calls — API-level on purpose, less flaky than driving the button).
    const enable = await page.request.post('/api/admin/oauth-clients/register-lock', {
      data: { locked: true },
    });
    expect(enable.status(), await enable.text()).toBe(200);
    const enableBody = (await enable.json()) as { locked: boolean; initialAccessToken?: string };
    expect(enableBody.locked).toBe(true);
    // The one-time RFC 7591 §3.1.1 token — captured here, never logged.
    const token = enableBody.initialAccessToken;
    expect(token).toMatch(/^cairn_oiat_/);

    // Cookieless register WITHOUT the bearer → 401 invalid_token.
    const denied = await registerRaw(request, { name: `g5-lock-denied-${run}` });
    expect(denied.status(), await denied.text()).toBe(401);
    const deniedBody = (await denied.json()) as { error: string };
    expect(deniedBody.error).toBe('invalid_token');

    // WITH the captured bearer → 201, row created.
    const allowed = await registerRaw(request, {
      name: `g5-lock-allowed-${run}`,
      bearer: token as string,
    });
    expect(allowed.status(), await allowed.text()).toBe(201);
    registered.push(((await allowed.json()) as { client_id: string }).client_id);

    // The lock transition was audited (metadata is { locked } only).
    const auditCount = await withSql(async (sql) => {
      const rows = await sql`
        SELECT id FROM audit_log
        WHERE action = 'oauth.register_lock_changed'
          AND workspace_id = ${seeded.workspaceId}::uuid`;
      return rows.length;
    });
    expect(auditCount).toBeGreaterThanOrEqual(1);

    // Disable through the same surface so the API-level off-path is exercised.
    const disable = await page.request.post('/api/admin/oauth-clients/register-lock', {
      data: { locked: false },
    });
    expect(disable.status(), await disable.text()).toBe(200);
  } finally {
    await removeLockState(seeded.workspaceId);
    await deleteClients(registered);
  }
});

// ---------------------------------------------------------------------------
// 2. Default open — the pinned zero-setup posture.
// ---------------------------------------------------------------------------
test('default open: with the lock off a single register is a 201', async ({ request }) => {
  const registered: string[] = [];
  try {
    const res = await registerRaw(request, { name: `g5-default-open-${stamp()}` });
    expect(res.status(), await res.text()).toBe(201);
    registered.push(((await res.json()) as { client_id: string }).client_id);
  } finally {
    await deleteClients(registered);
  }
});

// ---------------------------------------------------------------------------
// 3. Falsifiable core — the burst. LAST: it exhausts the in-process bucket
//    for the rest of this server-minute.
// ---------------------------------------------------------------------------
test('burst: valid registrations 429 with a parseable Retry-After within 35 attempts', async ({
  request,
}) => {
  const run = stamp();
  const registered: string[] = [];
  try {
    let sawLimit = false;
    for (let i = 0; i < 35; i++) {
      const res = await registerRaw(request, { name: `g5-burst-${run}-${i}` });
      if (res.status() === 201) {
        // Every pre-429 response must be a success — anything else fails here.
        registered.push(((await res.json()) as { client_id: string }).client_id);
        continue;
      }
      expect(res.status(), await res.text()).toBe(429);
      const retryAfter = res.headers()['retry-after'];
      expect(retryAfter, 'a 429 must carry Retry-After').toBeTruthy();
      const seconds = Number.parseInt(retryAfter as string, 10);
      expect(Number.isFinite(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('too_many_requests');
      sawLimit = true;
      break;
    }
    expect(
      sawLimit,
      'expected a 429 within 35 attempts (default ceilings 10/min ip, 30/min global)',
    ).toBe(true);

    // Throttled requests wrote nothing: every row this test created is one of
    // the tracked 201s.
    const rowCount = await withSql(async (sql) => {
      const rows = await sql`
        SELECT client_id FROM oauth_clients WHERE client_name LIKE ${`g5-burst-${run}-%`}`;
      return rows.length;
    });
    expect(rowCount).toBe(registered.length);
  } finally {
    await deleteClients(registered);
  }
});
