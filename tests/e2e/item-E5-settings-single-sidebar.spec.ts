// v0.10.0 Plan E E5 — settings double-sidebar refactor (polish-audit #19).
//
// Under /settings/* the (app) layout used to mount the workspace <Sidebar>
// (the PAGES tree aside) AND the settings layout mounted <SettingsSidebar> —
// two stacked left navs. The fix is <WorkspaceNavGate> in the (app) layout: a
// client pathname guard that unmounts the workspace nav chrome (desktop aside
// + mobile hamburger/drawer) for /settings and /settings/*, leaving the
// settings nav as the single left nav. usePathname() resolves during SSR, so
// hard loads of settings routes never flash both navs; on soft navigation the
// gate re-renders with the new pathname, restoring the sidebar on the way out.
//
// RED on the old build:
//  - (a)/(c): the `[aria-label="Workspace sidebar"]` aside is attached on
//    settings routes alongside the settings nav;
//  - (b): the aside never detaches when soft-navigating into settings;
//  - (d): the mobile hamburger bar ("Open navigation") renders above the hub.
import { devices } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';

// The workspace sidebar (C1 shell) carries this aria-label; the settings nav
// carries "Settings sections". Both are stable a11y contracts. Bare locators
// (not role queries) so the assertions count DOM attachment — the desktop
// aside is CSS-hidden below md and the mobile bar is CSS-hidden at md+, and
// the E5 contract is "unmounted", not merely "display:none at this width".
const WORKSPACE_SIDEBAR = '[aria-label="Workspace sidebar"]';
const SETTINGS_NAV = 'nav[aria-label="Settings sections"]';
const DRAWER_TRIGGER = 'button[aria-label="Open navigation"]';

test.describe('item E5 — settings routes show a single left nav', () => {
  test('(a) falsifiable core: /settings/account/profile mounts only the settings nav', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/account/profile');

    // Exactly one left nav: the settings sections nav, with its entries.
    const settingsNav = page.locator(SETTINGS_NAV);
    await expect(settingsNav).toHaveCount(1);
    await expect(settingsNav.getByRole('link', { name: 'Account' })).toBeVisible();

    // THE RED ASSERTIONS on the old build: the workspace sidebar aside (and
    // its PAGES tree heading) must not be in the DOM at all on settings routes.
    await expect(page.locator(WORKSPACE_SIDEBAR)).toHaveCount(0);
    await expect(page.locator('#sidebar-pages-heading')).toHaveCount(0);
    // The mobile drawer trigger is part of the same gated chrome.
    await expect(page.locator(DRAWER_TRIGGER)).toHaveCount(0);
  });

  test('(b) soft-nav round trip: sidebar unmounts entering settings, returns on leaving', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');
    const aside = page.locator(WORKSPACE_SIDEBAR);
    await expect(aside).toBeVisible();

    // Footer "Settings" link → client-side navigation into the hub (the
    // /settings index redirects on to /settings/account/profile).
    await aside.getByRole('link', { name: 'Settings' }).click();
    await expect(page.locator(SETTINGS_NAV)).toBeVisible({ timeout: 15_000 });
    await expect(aside).toHaveCount(0);

    // Settings nav "Search" entry → client-side navigation back out to a
    // workspace route; the gate re-mounts the workspace sidebar.
    await page.locator(SETTINGS_NAV).getByRole('link', { name: 'Search' }).click();
    await expect(page.locator(WORKSPACE_SIDEBAR)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(SETTINGS_NAV)).toHaveCount(0);
  });

  test('(c) deep settings hard load: /settings/admin/siem has no workspace sidebar', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // Seeded a11y user owns the workspace, so the admin hub is reachable.
    await page.goto('/settings/admin/siem');

    await expect(page.locator(SETTINGS_NAV)).toBeVisible();
    await expect(page.locator(WORKSPACE_SIDEBAR)).toHaveCount(0);
    await expect(page.locator(DRAWER_TRIGGER)).toHaveCount(0);
  });
});

test.describe('item E5 — mobile settings has no orphaned drawer', () => {
  // Pixel 7 emulation. defaultBrowserType is worker-scoped and must be
  // stripped before test.use inside a describe (playwright refuses
  // worker-scoped options there) — same recipe as item-E3.
  const { defaultBrowserType: _ignoredBrowserType, ...pixel7 } = devices['Pixel 7'];
  test.use(pixel7);

  test('(d) no hamburger/drawer on settings; settings nav still navigable', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/account/profile');

    // RED on the old build: the md:hidden hamburger top bar renders above the
    // settings hub on mobile. After E5 the whole chrome is unmounted.
    await expect(page.locator(DRAWER_TRIGGER)).toHaveCount(0);
    await expect(page.locator(WORKSPACE_SIDEBAR)).toHaveCount(0);

    // The app stays navigable without the drawer: the settings nav is the
    // mobile nav surface and its links work.
    const settingsNav = page.locator(SETTINGS_NAV);
    await expect(settingsNav).toBeVisible();
    await settingsNav.getByRole('link', { name: 'Notifications' }).click();
    await page.waitForURL('**/settings/notifications', { timeout: 15_000 });
    await expect(settingsNav).toBeVisible();
  });
});
