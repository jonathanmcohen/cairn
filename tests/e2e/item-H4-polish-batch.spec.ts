// v0.10.0 H4 — polish batch: four small reconciliations + one i18n fix.
//
//  H4a — the OIDC IdP admin form renders the `scopes` field its PATCH route
//        already accepted; persisted value re-renders after save + reload.
//  H4b — require_2fa enforcement: an un-enrolled member of a require-2fa
//        workspace is layout-redirected to /settings/security?enroll=required.
//  H4c — the settings nav gained the Workspace import entry (export had one),
//        gated identically to export (entry visible to every member; the page
//        itself is admin-only for BOTH).
//  H4d — health endpoints keep their split contract: /api/health is the
//        always-200 body-signal diagnostic, /healthz is the readiness probe.
//  H4e — the ⌘/ sheet renders "Quick capture", not the raw
//        'shortcuts.quickCapture' key (labelKey fixed to shortcut.quickCapture
//        + keyed in en/es/ar).
//
// Determinism notes (persistent e2e dev DB):
//  - H4a creates its IdP row with a unique stamp and deletes it (row via the
//    DELETE API, audit rows via SQL) in finally.
//  - H4b snapshots the seeded workspace's require_2fa and restores it in
//    finally — leaving it true would bounce every later spec's sign-ins to
//    the enroll page (the dev DB persists!).
import postgres from 'postgres';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

function stamp(): string {
  return `h4-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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

test.describe('item H4 — polish batch', () => {
  test('H4a: OIDC scopes field persists via the PATCH and the re-rendered form shows it', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const mark = stamp();
    let idpId: string | null = null;
    try {
      // Create the IdP row through the real admin API (full creation via the
      // UI form is not what is under test; the PATCH + re-render is).
      const created = await page.request.post('/api/admin/sso/oidc', {
        data: {
          name: `H4a OIDC ${mark}`,
          metadata: {
            issuer: 'https://idp.example.invalid',
            clientId: `h4a-client-${mark}`,
            clientSecret: `h4a-secret-${mark}`,
          },
          attributeMap: { email: 'email', name: 'name' },
          enabled: false,
        },
      });
      expect(created.status(), await created.text().catch(() => '')).toBe(201);
      idpId = ((await created.json()) as { id: string }).id;

      // Fresh row (no scopes in metadata) → the form shows the default.
      await page.goto(`/settings/admin/sso/oidc/${idpId}/edit`);
      const scopes = page.locator('#oidc-scopes');
      await expect(scopes).toBeVisible({ timeout: 15_000 });
      await expect(scopes).toHaveValue('openid profile email');

      // Set a unique scopes string via the UI form and save (the form PATCHes
      // /api/admin/sso/oidc/[idpId] and pushes back to the SSO console).
      const uniqueScopes = `openid profile email h4a:${mark}`;
      await scopes.fill(uniqueScopes);
      await page.getByRole('button', { name: 'Save changes' }).click();
      // Anchored: the SSO console index ('/admin/sso' pushes through the 308
      // alias to '/settings/admin/sso'), NOT the still-open edit URL (which
      // also contains '/admin/sso' but ends in '/edit').
      await expect(page).toHaveURL(/\/admin\/sso\/?$/, { timeout: 30_000 });

      // Reload the edit page: the PATCH persisted and the re-rendered form
      // shows the stored value.
      await page.goto(`/settings/admin/sso/oidc/${idpId}/edit`);
      await expect(page.locator('#oidc-scopes')).toHaveValue(uniqueScopes, { timeout: 15_000 });
    } finally {
      if (idpId) {
        await page.request.delete(`/api/admin/sso/oidc/${idpId}`).catch(() => {});
        await withSql(async (sql) => {
          await sql`delete from audit_log where target_id = ${idpId}::uuid`;
        });
      }
    }
  });

  test('H4b: un-enrolled member of a require-2fa workspace is forced to enroll', async ({
    browser,
    seeded,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');

    // Snapshot the flag so finally restores exactly what was found.
    const prior = await withSql(async (sql) => {
      const [row] = await sql`
        select require_2fa from workspaces where id = ${seeded.workspaceId}::uuid
      `;
      return Boolean((row as { require_2fa: boolean }).require_2fa);
    });

    try {
      // Second user: editor in the seeded workspace, WITHOUT TOTP. The dev DB
      // persists, so defensively drop any enrollment a previous life left.
      const member = await seedSecondUser(databaseUrl, {
        workspaceId: seeded.workspaceId,
        email: 'h4-member@cairn.test',
        password: 'h4-member-password-1',
        role: 'editor',
      });
      await withSql(async (sql) => {
        await sql`delete from user_totp where user_id = ${member.userId}::uuid`;
        await sql`update workspaces set require_2fa = true where id = ${seeded.workspaceId}::uuid`;
      });

      const { context, page: memberPage } = await signInSecondUser(browser, member);
      try {
        // Any (app) page route → the layout gate redirects to the enrollment
        // surface. goto follows the server redirect chain to a real load.
        await memberPage.goto(`/pages/${seeded.pageId}`);
        await expect(memberPage).toHaveURL(/\/settings\/security\?enroll=required/, {
          timeout: 30_000,
        });

        // The security page itself is exempt (no redirect loop): the URL
        // settles there instead of bouncing.
        await memberPage.goto('/settings/security');
        await expect(memberPage).toHaveURL(/\/settings\/security/, { timeout: 30_000 });
      } finally {
        await context.close();
      }
    } finally {
      // CRITICAL cleanup: restore require_2fa — the dev DB persists across
      // runs, and leaving it true bounces every later spec's sign-in.
      await withSql(async (sql) => {
        await sql`
          update workspaces set require_2fa = ${prior} where id = ${seeded.workspaceId}::uuid
        `;
      });
    }
  });

  test('H4c: settings nav shows the import entry, routes to the import page, and is gated like export', async ({
    browser,
    page,
    seeded,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    await signIn(page, seeded);

    await page.goto('/settings/developer');
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    const importLink = nav.getByRole('link', { name: 'Workspace import' });
    const exportLink = nav.getByRole('link', { name: 'Workspace archive' });
    // Gating parity in the same DOM: the import entry renders exactly where
    // (and whenever) the export entry does — both live un-gated in the
    // Developer section; both PAGES are admin-only via requireRole('admin').
    await expect(importLink).toBeVisible({ timeout: 15_000 });
    await expect(exportLink).toBeVisible();

    await importLink.click();
    await expect(page).toHaveURL(/\/settings\/developer\/import/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Import workspace data' })).toBeVisible({
      timeout: 15_000,
    });

    // Role parity from the other side: the H4b editor (cheap — worker-cached
    // cookie jar) sees both entries or neither. Export's entry has never been
    // hidden from members, so both must be visible.
    const member = await seedSecondUser(databaseUrl, {
      workspaceId: seeded.workspaceId,
      email: 'h4-member@cairn.test',
      password: 'h4-member-password-1',
      role: 'editor',
    });
    const { context, page: memberPage } = await signInSecondUser(browser, member);
    try {
      // /settings/developer itself redirects to the admin-gated api-keys page
      // (which bounces non-admins to '/'); tokens is the session-only child,
      // so the Developer section is active and its nav children render.
      await memberPage.goto('/settings/developer/tokens');
      const memberNav = memberPage.getByRole('navigation', { name: 'Settings sections' });
      await expect(memberNav.getByRole('link', { name: 'Workspace archive' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(memberNav.getByRole('link', { name: 'Workspace import' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('H4d: /api/health keeps the always-200 body-signal contract; /healthz 200s when healthy', async ({
    page,
  }) => {
    // Both endpoints are PUBLIC_PATHS — no sign-in needed.
    const health = await page.request.get('/api/health');
    expect(health.status()).toBe(200);
    const healthBody = (await health.json()) as { status: string; db: string; version: string };
    expect(healthBody.db).toBe('ok');
    expect(healthBody.status).toBe('ok');
    expect(typeof healthBody.version).toBe('string');

    const healthz = await page.request.get('/healthz');
    expect(healthz.status()).toBe(200);
    const zBody = (await healthz.json()) as { status: string; db: string; uptime_seconds: number };
    expect(zBody.status).toBe('ok');
    expect(zBody.db).toBe('ok');
    expect(typeof zBody.uptime_seconds).toBe('number');
  });

  test('H4e: the shortcuts sheet renders "Quick capture", never the raw key string', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    // E1 idiom: bare `?` on a non-editable target opens the sheet.
    await page.keyboard.type('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // The raw labelKey must not leak anywhere in the sheet…
    await expect(sheet.getByText('shortcuts.quickCapture')).toHaveCount(0);
    // …and the translated row is present with its Mod+Shift+N binding.
    const row = sheet.locator('li', { hasText: 'Quick capture' });
    await expect(row).toBeVisible();
    await expect(row.locator('kbd')).toHaveCount(1);
  });
});
