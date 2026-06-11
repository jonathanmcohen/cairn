// v0.10.0 D4 — admin health/readiness panel (/settings/admin/health +
// GET /api/admin/health).
//
// The panel is the HUMAN surface over the instance's health signals: db
// reachability, bundled app version, per-replica uptime, and the A4
// collab-bridge configured/connected signal (previously buried on the upgrade
// page). /healthz stays the machine probe.
//
// Layer split for the DEGRADED render: the e2e harness can't take its own
// Postgres down mid-run (the booted app and every later spec share it), so
// db-down / collab-unreachable are proven with injected failing probes in
// tests/lib/health-panel.test.ts (snapshot degrades instead of throwing) and
// tests/components/admin/health-view-degraded.test.tsx (destructive/warning
// styling + alert role). This file exercises the healthy path end to end.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

test.describe('item D4 — admin health panel', () => {
  test('admin reaches the panel via the sidebar; db up, version matches package.json, uptime + /healthz pointer rendered', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // Land on an admin leaf so the Admin section's children render, then
    // navigate through the real sidebar entry.
    await page.goto('/settings/admin/audit');
    await page.getByRole('link', { name: 'Health', exact: true }).click();
    await page.waitForURL('**/settings/admin/health');

    // Database row: the harness DB is up.
    const dbRow = page.getByTestId('health-db');
    await expect(dbRow).toBeVisible({ timeout: 15_000 });
    await expect(dbRow).toHaveAttribute('data-state', 'up');
    await expect(dbRow).toContainText('Up');

    // App version: same source as /healthz — the bundled package.json.
    await expect(page.getByTestId('health-version')).toContainText(packageVersion());

    // Uptime: present and labeled per-replica (multi-replica honesty rule —
    // behind an LB each replica has its own process.uptime()).
    const uptimeRow = page.getByTestId('health-uptime');
    await expect(uptimeRow).toContainText('Uptime (this replica)');
    await expect(uptimeRow).toContainText(/\d+s/);

    // The machine-probe pointer: humans read this page, probes hit /healthz.
    await expect(page.getByTestId('health-probe-note')).toContainText('/healthz');
  });

  test('body-field contract pinned: GET /api/health is ALWAYS HTTP 200 with the db state in the body only', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // TRAP (documented): /api/health reports its real state in the BODY
    // (`db: 'ok' | 'down'`) while the HTTP status code is ALWAYS 200 — a load
    // balancer keyed on the status code will never shed a broken replica
    // through this route. That's why the D4 panel runs its OWN server-side
    // probe (and points operators at /healthz, which does 503 on db-down)
    // instead of trusting this status code. Changing /api/health's status-code
    // behavior is item H4d, not D4 — this spec pins the CURRENT contract so a
    // silent change there is caught.
    const res = await page.request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status: string; db: string; version: string };
    expect(body.db).toBe('ok');
    expect(body.status).toBe('ok');
  });

  test('collab bridge: harness sets CAIRN_COLLAB_INTERNAL_URL, so the panel must NOT show unconfigured', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/health');
    const collabRow = page.getByTestId('health-collab');
    await expect(collabRow).toBeVisible({ timeout: 15_000 });
    // playwright.e2e.config.ts points the booted server at the live harness
    // collab process (ws/http on :11334), mirroring docker-compose. With the
    // process running this yields 'connected'; the hard assertion is that the
    // A4 silent-OFF state ('unconfigured') can never be what admins see here.
    const state = await collabRow.getAttribute('data-state');
    expect(state).not.toBe('unconfigured');
    expect(['connected', 'unreachable']).toContain(state);
  });

  test('editor role: direct GET to /api/admin/health answers 403', async ({ browser, seeded }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    // A dedicated editor account (NOT the shared a11y-2 user — the dev DB is
    // persistent and another spec may have granted that user a higher role).
    // Fixed email on purpose: seedSecondUser is idempotent per email, so the
    // persistent dev DB doesn't accumulate one user row per run.
    const editor = await seedSecondUser(databaseUrl, {
      workspaceId: seeded.workspaceId,
      email: 'd4-editor@cairn.test',
      password: 'd4-editor-password-1',
      role: 'editor',
    });
    const { context, page: editorPage } = await signInSecondUser(browser, editor);
    try {
      // The settings page itself is RSC-gated by requireRole('admin'); the
      // JSON route is what tooling would hit, so assert it directly — same
      // posture as the D1/D2/D3 editor-role specs.
      const res = await editorPage.request.get('/api/admin/health');
      expect(res.status()).toBe(403);
    } finally {
      await context.close();
    }
  });
});
