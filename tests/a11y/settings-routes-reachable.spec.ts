import { expect, signIn, test } from './fixtures';

// v0.9.9 A4 (#2/#3/#4) — route-reachability smoke. Every settings/admin/
// developer slug surfaced in the sidebar (src/components/settings/sidebar.tsx)
// plus the two new redirect aliases must resolve to a 200 with a known landmark
// — not a 404. This is the "end-to-end UI acceptance" gate the v0.9.8 audit
// recommended (12 features regressed because routes were never click-tested).
//
// Runs in the booted-app Playwright harness (tests/a11y). The auth gate
// requires a signed-in session; we reuse the worker's cached cookies.

const SETTINGS_ROUTES = [
  '/settings',
  '/settings/account',
  '/settings/account/theme',
  '/settings/notifications',
  '/settings/security',
  '/settings/security/encryption',
  '/settings/workspace',
  '/settings/workspace/general',
  '/settings/workspace/members',
  '/settings/workspace/trash',
  '/settings/workspace/pinned-pages',
  '/settings/workspace/export-static-site',
  '/settings/developer',
  '/settings/developer/tokens',
  '/settings/developer/automation',
  '/settings/developer/connectors',
  '/settings/developer/export',
  '/settings/admin/users',
  '/settings/admin/sso',
  '/settings/admin/mfa',
  '/settings/admin/encryption',
  '/settings/admin/webhooks',
  '/settings/admin/api-keys',
  '/settings/admin/audit',
  '/settings/admin/siem',
  '/settings/admin/upgrade',
  '/settings/admin/federated',
  // v0.9.9 C5 (#186) — chat-bridge now lives inside the hub.
  '/settings/admin/chat-bridge',
  '/settings/admin/chat-bridge/channels',
];

// (alias source, expected resolved path)
const ALIASES: Array<[string, string]> = [
  ['/trash-retention', '/settings/workspace/trash'],
  ['/access-tokens', '/settings/developer/tokens'],
  // Legacy chat-bridge paths 308-redirect into the hub (v0.9.9 C5 #186).
  ['/admin/chat-bridge', '/settings/admin/chat-bridge'],
  ['/admin/chat-bridge/channels', '/settings/admin/chat-bridge/channels'],
];

test.describe('settings/admin/developer route reachability (#2/#3/#4)', () => {
  test.beforeEach(async ({ page, seeded }) => {
    await signIn(page, seeded);
  });

  for (const route of SETTINGS_ROUTES) {
    test(`${route} resolves with a heading (not a 404)`, async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status(), `${route} status`).toBeLessThan(400);
      // A reachable settings page always renders at least one heading landmark.
      await expect(page.getByRole('heading').first()).toBeVisible();
      // Next's not-found renders this copy; assert it is NOT present.
      await expect(page.getByText(/this page could not be found/i)).toHaveCount(0);
    });
  }

  for (const [from, to] of ALIASES) {
    test(`alias ${from} → ${to}`, async ({ page }) => {
      await page.goto(from);
      await page.waitForURL(`**${to}`, { timeout: 30_000 });
      expect(page.url()).toContain(to);
    });
  }
});
