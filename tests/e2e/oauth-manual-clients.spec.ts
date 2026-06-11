// Post-v0.10.0 — manual OAuth client provisioning (admin).
//
// The instance runs on a LAN where some MCP clients can't reach (or don't
// support) RFC 7591 dynamic registration, so an admin mints
// client_id/client_secret pairs from /settings/admin/oauth-clients and pastes
// them into the client's config. These specs drive the REAL booted app
// through the proxy, mirroring tests/e2e/item-F-mcp-oauth-flow.spec.ts: the
// machine-to-machine steps (token exchange, MCP call) run on the cookieless
// `request` fixture, the consent screen runs in the logged-in browser. The
// load-bearing proof is (a): credentials created BY HAND in the admin UI
// complete the full authorization-code+PKCE round trip — authorize → consent
// → code → token — exactly like a dynamically-registered client would.
//
// The e2e dev DB is persistent across runs: every client is stamped uniquely
// and cleaned up (tokens then client rows) in a finally.
import { createHash, randomBytes } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import postgres from 'postgres';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

function stamp(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  return url;
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Idempotent cleanup: token rows first, then the client rows. Also sweeps by
 * the spec's stamped client_name in case creation succeeded but the test
 * failed before the client_id was captured (the dev DB persists across runs).
 */
async function cleanupClients(clientIds: string[], names: string[] = []): Promise<void> {
  const sql = postgres(dbUrl(), { max: 1 });
  try {
    const byName =
      names.length > 0
        ? await sql`select client_id from oauth_clients where client_name in ${sql(names)}`
        : [];
    const ids = [
      ...new Set([...clientIds, ...byName.map((r) => (r as { client_id: string }).client_id)]),
    ];
    if (ids.length === 0) return;
    await sql`delete from oauth_tokens where client_id in ${sql(ids)}`;
    await sql`delete from oauth_clients where client_id in ${sql(ids)}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const SCOPE = 'mcp:read pages:read';

/**
 * Authorize + consent in the logged-in browser → authorization code (same
 * helper shape as item-F-mcp-oauth-flow.spec.ts).
 */
async function getAuthCode(
  page: Page,
  args: { clientId: string; cb: string; challenge: string; state: string },
): Promise<string> {
  const qs = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.cb,
    response_type: 'code',
    code_challenge: args.challenge,
    code_challenge_method: 'S256',
    scope: SCOPE,
    state: args.state,
  });
  await page.goto(`/api/oauth/authorize?${qs.toString()}`);
  const allow = page.locator('button.allow');
  await expect(allow).toBeVisible({ timeout: 15_000 });
  await Promise.all([
    page.waitForURL((u) => u.toString().startsWith(args.cb), { timeout: 15_000 }),
    allow.click(),
  ]);
  const url = new URL(page.url());
  expect(url.searchParams.get('state'), 'state echoed').toBe(args.state);
  const code = url.searchParams.get('code');
  expect(code, 'authorization code present in redirect').toBeTruthy();
  return code as string;
}

/** authorization_code + PKCE exchange as a confidential client (client_secret_post). */
function exchangeCode(
  request: APIRequestContext,
  args: {
    clientId: string;
    code: string;
    cb: string;
    verifier: string;
    clientSecret?: string;
  },
) {
  return request.post('/api/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: args.clientId,
      code: args.code,
      redirect_uri: args.cb,
      code_verifier: args.verifier,
      ...(args.clientSecret ? { client_secret: args.clientSecret } : {}),
    },
  });
}

function clientRow(page: Page, name: string) {
  return page.getByTestId('oauth-client-row').filter({ hasText: name });
}

test.describe('manual OAuth client provisioning (admin)', () => {
  test('(a) admin creates a confidential client in the UI → show-once panel → full PKCE round trip with the minted credentials', async ({
    page,
    request,
    seeded,
  }) => {
    const mark = stamp();
    const name = `manual-${mark}`;
    const clientIds: string[] = [];
    try {
      await signIn(page, seeded);
      await page.goto('/settings/admin/oauth-clients');
      const origin = new URL(page.url()).origin;
      const cb = `${origin}/__manual_cb__${mark}`;

      // Create through the card: name + one redirect URI + confidential type
      // (toggle buttons, not a native select).
      const confidentialToggle = page.getByTestId('oauth-create-type-confidential');
      await expect(confidentialToggle).toHaveAttribute('aria-pressed', 'true'); // default
      await confidentialToggle.click();
      await page.getByTestId('oauth-create-name').fill(name);
      await page.getByTestId('oauth-create-uris').fill(cb);
      await page.getByTestId('oauth-create-submit').click();

      // Show-once panel carries BOTH credentials plus the store-it-now note.
      const panel = page.getByTestId('oauth-created-panel');
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel).toContainText('shown only once');
      const clientId = (await panel.getByTestId('oauth-created-client-id').textContent()) ?? '';
      const clientSecret = (await panel.getByTestId('oauth-created-secret').textContent()) ?? '';
      expect(clientId).toMatch(/^[0-9a-f]{32}$/);
      expect(clientSecret).toMatch(/^cairn_ocs_/);
      clientIds.push(clientId);

      // The created client shows up in the registry below as confidential.
      await expect(clientRow(page, name)).toBeVisible({ timeout: 15_000 });
      await expect(clientRow(page, name)).toContainText('Confidential');

      // THE round trip: authorize → consent → code → token, exactly as a
      // dynamically-registered client would, but with the hand-minted pair.
      const { verifier, challenge } = pkcePair();
      const code = await getAuthCode(page, { clientId, cb, challenge, state: `a-${mark}` });
      const tokRes = await exchangeCode(request, { clientId, code, cb, verifier, clientSecret });
      expect(tokRes.status(), await tokRes.text().catch(() => '')).toBe(200);
      const tok = await tokRes.json();
      expect(tok.access_token).toMatch(/^cairn_oauth_/);
      expect(tok.refresh_token).toMatch(/^cairn_oart_/);
      expect(tok.token_type).toBe('Bearer');

      // The issued token really works: an authenticated MCP call succeeds.
      const mcpRes = await request.post('/api/mcp', {
        headers: {
          authorization: `Bearer ${tok.access_token}`,
          'content-type': 'application/json',
        },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      });
      expect(mcpRes.ok(), 'authed MCP tools/list 200').toBe(true);

      // Confidential is enforced: omitting the secret never reaches grant
      // validation — 401 invalid_client (client auth precedes code handling,
      // so a bogus code is fine here).
      const noSecret = await exchangeCode(request, { clientId, code: 'bogus', cb, verifier });
      expect(noSecret.status(), 'missing client_secret → 401').toBe(401);
      expect((await noSecret.json()).error).toBe('invalid_client');
    } finally {
      await cleanupClients(clientIds, [name]);
    }
  });

  test('(b) rotate: old secret stops working at the token endpoint, new secret completes the exchange', async ({
    page,
    request,
    seeded,
  }) => {
    const mark = stamp();
    const name = `rotate-${mark}`;
    const clientIds: string[] = [];
    try {
      await signIn(page, seeded);
      await page.goto('/settings/admin/oauth-clients');
      const origin = new URL(page.url()).origin;
      const cb = `${origin}/__manual_cb__${mark}`;

      // Provision via the admin API (the UI path is covered by (a)).
      const createRes = await page.request.post('/api/admin/oauth-clients', {
        data: { clientName: name, redirectUris: [cb], confidential: true },
      });
      expect(createRes.status(), await createRes.text().catch(() => '')).toBe(201);
      const created = (await createRes.json()) as {
        client: { clientId: string };
        clientSecret: string;
      };
      const clientId = created.client.clientId;
      const oldSecret = created.clientSecret;
      clientIds.push(clientId);
      expect(oldSecret).toMatch(/^cairn_ocs_/);

      // Rotate through the row action + confirm dialog → show-once panel.
      await page.goto('/settings/admin/oauth-clients');
      const row = clientRow(page, name);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId('oauth-client-rotate').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('old secret stops working');
      await dialog.getByRole('button', { name: 'Rotate secret' }).click();

      const panel = page.getByTestId('oauth-rotated-panel');
      await expect(panel).toBeVisible({ timeout: 15_000 });
      const newSecret = (await panel.getByTestId('oauth-rotated-secret').textContent()) ?? '';
      expect(newSecret).toMatch(/^cairn_ocs_/);
      expect(newSecret).not.toBe(oldSecret);

      // OLD secret is dead at the token endpoint: client auth fails before any
      // grant handling → 401 invalid_client (bogus code never consumed).
      const { verifier, challenge } = pkcePair();
      const oldAttempt = await exchangeCode(request, {
        clientId,
        code: 'bogus',
        cb,
        verifier,
        clientSecret: oldSecret,
      });
      expect(oldAttempt.status(), 'old secret → 401').toBe(401);
      expect((await oldAttempt.json()).error).toBe('invalid_client');

      // NEW secret completes a real exchange.
      const code = await getAuthCode(page, { clientId, cb, challenge, state: `b-${mark}` });
      const newAttempt = await exchangeCode(request, {
        clientId,
        code,
        cb,
        verifier,
        clientSecret: newSecret,
      });
      expect(newAttempt.status(), await newAttempt.text().catch(() => '')).toBe(200);
      expect((await newAttempt.json()).access_token).toMatch(/^cairn_oauth_/);
    } finally {
      await cleanupClients(clientIds, [name]);
    }
  });

  test('(c) non-admin: POST /api/admin/oauth-clients answers 403 and creates nothing', async ({
    browser,
    seeded,
  }) => {
    const mark = stamp();
    const name = `editor-denied-${mark}`;

    // A dedicated editor account (NOT the shared a11y-2 user — the dev DB is
    // persistent and another spec may have granted that user a higher role).
    const editor = await seedSecondUser(dbUrl(), {
      workspaceId: seeded.workspaceId,
      email: 'manual-oauth-editor@cairn.test',
      password: 'manual-oauth-editor-pw-1',
      role: 'editor',
    });
    const { context, page: editorPage } = await signInSecondUser(browser, editor);
    try {
      const res = await editorPage.request.post('/api/admin/oauth-clients', {
        data: {
          clientName: name,
          redirectUris: ['https://example.invalid/cb'],
          confidential: true,
        },
      });
      expect(res.status()).toBe(403);

      // Rotate is gated the same way (role check precedes existence lookup).
      const rotate = await editorPage.request.post(
        '/api/admin/oauth-clients/00000000-0000-4000-8000-000000000000/rotate',
      );
      expect(rotate.status()).toBe(403);
    } finally {
      await context.close();
    }

    // The gate really blocked the insert.
    const sql = postgres(dbUrl(), { max: 1 });
    try {
      const rows = await sql`select id from oauth_clients where client_name = ${name}`;
      expect(rows).toHaveLength(0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
