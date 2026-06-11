// v0.10.0 D3 — admin OAuth client registry (/settings/admin/oauth-clients →
// GET/DELETE /api/admin/oauth-clients).
//
// RFC 7591 registration (`POST /api/oauth/register`) is unauthenticated BY
// DESIGN, so anyone who can reach the instance can flood it with client rows;
// before D3 there was no surface that even listed them. These specs register
// clients through the REAL open endpoint (the `request` fixture carries no
// session cookies) and assert the admin page sees + purges them.
//
// Layer split for "delete revokes tokens": minting a real bearer token in e2e
// would need the full PKCE dance, so the spec seeds an oauth_tokens row
// directly in the dev DB (established harness pattern) and asserts the DB-level
// soft-revoke (revoked_at set). The complementary proof — that a revoked row no
// longer resolves to a bearer context — lives in the unit suites
// (tests/api/oauth/admin-clients.spec.ts asserts verifyOauthAccessToken → null,
// and tests/api/oauth/revoke.spec.ts covers resolveToken's revoked-check).
//
// The e2e dev DB is persistent across runs: every client is stamped uniquely
// and cleaned up in a finally.
import { createHash } from 'node:crypto';
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

/** Register a client through the REAL unauthenticated endpoint (no cookies). */
async function registerClientUnauthed(
  request: APIRequestContext,
  name: string,
): Promise<{ clientId: string }> {
  const res = await request.post('/api/oauth/register', {
    data: {
      client_name: name,
      redirect_uris: ['https://example.invalid/d3/callback'],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { client_id: string };
  return { clientId: body.client_id };
}

/** oauth_clients uuid primary key for a public client_id (null if purged). */
async function clientUuid(clientId: string): Promise<string | null> {
  const sql = postgres(dbUrl(), { max: 1 });
  try {
    const rows = await sql`select id from oauth_clients where client_id = ${clientId}`;
    return rows.length > 0 ? (rows[0] as { id: string }).id : null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Seed a grant row bound to `clientId` for the primary seeded user, straight
 * into the dev DB (postgres-js, the established harness pattern). The hash is
 * a unique sha256 so the row can never collide with a real token.
 */
async function seedTokenRow(args: {
  clientId: string;
  userEmail: string;
  workspaceId: string;
}): Promise<string> {
  const sql = postgres(dbUrl(), { max: 1 });
  try {
    const [user] = await sql`select id from users where email = ${args.userEmail}`;
    if (!user) throw new Error(`e2e harness: no user row for ${args.userEmail}`);
    const hash = createHash('sha256').update(`d3-token-${stamp()}`).digest('hex');
    const rows = await sql`
      insert into oauth_tokens
        (access_token_hash, client_id, user_id, workspace_id, scopes, access_expires_at)
      values
        (${hash}, ${args.clientId}, ${(user as { id: string }).id}, ${args.workspaceId},
         ${sql.array(['mcp:read'])}, now() + interval '1 hour')
      returning id
    `;
    return (rows[0] as { id: string }).id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function tokenRow(id: string): Promise<{ id: string; revoked_at: Date | null } | null> {
  const sql = postgres(dbUrl(), { max: 1 });
  try {
    const rows = await sql`select id, revoked_at from oauth_tokens where id = ${id}`;
    return rows.length > 0 ? (rows[0] as { id: string; revoked_at: Date | null }) : null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Idempotent cleanup: token rows first (no FK, but keep the DB tidy), then clients. */
async function cleanupClients(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const sql = postgres(dbUrl(), { max: 1 });
  try {
    await sql`delete from oauth_tokens where client_id in ${sql(clientIds)}`;
    await sql`delete from oauth_clients where client_id in ${sql(clientIds)}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function clientRow(page: Page, name: string) {
  return page.getByTestId('oauth-client-row').filter({ hasText: name });
}

test.describe('item D3 — OAuth registered-clients admin registry', () => {
  test('registration flood is visible and purgeable: 3 unauthenticated registrations → admin lists all → UI delete removes one', async ({
    page,
    request,
    seeded,
  }) => {
    const prefix = `d3-flood-${stamp()}`;
    const names = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`];
    const clientIds: string[] = [];
    try {
      for (const name of names) {
        const { clientId } = await registerClientUnauthed(request, name);
        clientIds.push(clientId);
      }

      await signIn(page, seeded);
      await page.goto('/settings/admin/oauth-clients');
      for (const name of names) {
        await expect(clientRow(page, name)).toBeVisible({ timeout: 15_000 });
      }

      // Delete the first via the row button + the Radix confirm dialog.
      const victim = names[0] as string;
      await clientRow(page, victim).getByTestId('oauth-client-delete').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // Destructive copy pins the consequence: revokes all tokens issued to the app.
      await expect(dialog).toContainText('revokes all tokens issued to this app');
      await dialog.getByRole('button', { name: 'Delete client' }).click();

      await expect(clientRow(page, victim)).toHaveCount(0, { timeout: 15_000 });
      await expect(clientRow(page, names[1] as string)).toBeVisible();
      await expect(clientRow(page, names[2] as string)).toBeVisible();
      // DB row is really gone (not just hidden).
      expect(await clientUuid(clientIds[0] as string)).toBeNull();
    } finally {
      await cleanupClients(clientIds);
    }
  });

  test('deleting a client revokes its tokens (DB-level soft-revoke; bearer rejection is unit-covered)', async ({
    page,
    request,
    seeded,
  }) => {
    const name = `d3-revoke-${stamp()}`;
    const clientIds: string[] = [];
    try {
      const { clientId } = await registerClientUnauthed(request, name);
      clientIds.push(clientId);
      const tokenId = await seedTokenRow({
        clientId,
        userEmail: seeded.userEmail,
        workspaceId: seeded.workspaceId,
      });

      await signIn(page, seeded);
      const uuid = await clientUuid(clientId);
      expect(uuid).not.toBeNull();
      const res = await page.request.delete(`/api/admin/oauth-clients/${uuid}`);
      expect(res.status(), await res.text()).toBe(200);
      expect((await res.json()) as { revokedGrants: number }).toMatchObject({
        ok: true,
        revokedGrants: 1,
      });

      // Soft-revoke, matching the RFC 7009 pattern: the row REMAINS (audit
      // trail) but revoked_at is set, so resolveToken's isNull(revoked_at)
      // guard rejects the bearer immediately.
      const row = await tokenRow(tokenId);
      expect(row).not.toBeNull();
      expect(row?.revoked_at).not.toBeNull();
      expect(await clientUuid(clientId)).toBeNull();
    } finally {
      await cleanupClients(clientIds);
    }
  });

  test('grants vs clients distinction: revoking a USER grant leaves the registered app listed', async ({
    page,
    request,
    seeded,
  }) => {
    const name = `d3-distinct-${stamp()}`;
    const clientIds: string[] = [];
    try {
      const { clientId } = await registerClientUnauthed(request, name);
      clientIds.push(clientId);
      const tokenId = await seedTokenRow({
        clientId,
        userEmail: seeded.userEmail,
        workspaceId: seeded.workspaceId,
      });

      await signIn(page, seeded);
      // Revoke the GRANT through the v0.9.16 developer-connections surface —
      // the same route the Settings → Developer → Tokens UI calls.
      const res = await page.request.delete(`/api/dev/oauth-connections/${tokenId}`);
      expect(res.status(), await res.text()).toBe(204);
      const row = await tokenRow(tokenId);
      expect(row?.revoked_at).not.toBeNull();

      // The registered APPLICATION is untouched: still listed in the admin
      // registry (revoking a per-user connection does NOT deregister the app).
      await page.goto('/settings/admin/oauth-clients');
      await expect(clientRow(page, name)).toBeVisible({ timeout: 15_000 });
      expect(await clientUuid(clientId)).not.toBeNull();
    } finally {
      await cleanupClients(clientIds);
    }
  });

  test('editor role: GET and DELETE answer 403', async ({ browser, request, seeded }) => {
    const name = `d3-editor-${stamp()}`;
    const clientIds: string[] = [];
    try {
      const { clientId } = await registerClientUnauthed(request, name);
      clientIds.push(clientId);
      const uuid = await clientUuid(clientId);
      expect(uuid).not.toBeNull();

      // A dedicated editor account (NOT the shared a11y-2 user — the dev DB is
      // persistent and another spec may have granted that user a higher role).
      const editor = await seedSecondUser(dbUrl(), {
        workspaceId: seeded.workspaceId,
        email: 'd3-editor@cairn.test',
        password: 'd3-editor-password-1',
        role: 'editor',
      });
      const { context, page: editorPage } = await signInSecondUser(browser, editor);
      try {
        const list = await editorPage.request.get('/api/admin/oauth-clients');
        expect(list.status()).toBe(403);
        const del = await editorPage.request.delete(`/api/admin/oauth-clients/${uuid}`);
        expect(del.status()).toBe(403);
      } finally {
        await context.close();
      }

      // The gate left the row in place.
      expect(await clientUuid(clientId)).not.toBeNull();
    } finally {
      await cleanupClients(clientIds);
    }
  });

  test('deleting a client writes an oauth.client_deleted audit row with the client name', async ({
    page,
    request,
    seeded,
  }) => {
    const name = `d3-audit-${stamp()}`;
    const clientIds: string[] = [];
    try {
      const { clientId } = await registerClientUnauthed(request, name);
      clientIds.push(clientId);
      const uuid = await clientUuid(clientId);

      await signIn(page, seeded);
      const res = await page.request.delete(`/api/admin/oauth-clients/${uuid}`);
      expect(res.status(), await res.text()).toBe(200);

      const sql = postgres(dbUrl(), { max: 1 });
      try {
        const rows = await sql`
          select metadata from audit_log
          where action = 'oauth.client_deleted' and metadata->>'name' = ${name}
        `;
        expect(rows).toHaveLength(1);
        const metadata = (rows[0] as { metadata: Record<string, unknown> }).metadata;
        expect(metadata.clientId).toBe(clientId);
        expect(metadata.revokedGrants).toBe(0);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanupClients(clientIds);
    }
  });
});
