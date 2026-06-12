// v0.10.2 P11 — 16px leading icons on the settings top-level nav links.
// The a11y-critical assertion: icons are aria-hidden, so every link's
// accessible name stays exactly its label — an icon missing aria-hidden
// pollutes every screen-reader name (what a markup-presence check misses).
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

const TOP_LABELS = [
  'Search',
  'Account',
  'Workspace',
  'Admin',
  'Developer',
  'Notifications',
  'Security',
];

test.describe('P11 — settings nav rail icons', () => {
  test('each visible top-level link carries exactly one aria-hidden 16px svg', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/workspace/members');
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav).toBeVisible({ timeout: 15_000 });

    for (const label of TOP_LABELS) {
      // exact accessible name == label only (icons hidden from the a11y tree).
      const link = nav.getByRole('link', { name: label, exact: true });
      await expect(link, `link "${label}"`).toBeVisible();
      const svgs = link.locator('svg');
      await expect(svgs, `svg count in "${label}"`).toHaveCount(1);
      const size = await svgs.first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
      expect(size).toEqual({ w: 16, h: 16 });
      expect(await svgs.first().getAttribute('aria-hidden')).toBe('true');
    }

    // Scope guard: child links carry no icons (Workspace children visible on
    // this route).
    const child = nav.getByRole('link', { name: 'Members', exact: true });
    await expect(child).toBeVisible();
    await expect(child.locator('svg')).toHaveCount(0);
  });

  test('non-admin: Admin link (and icon) absent; the rest keep icons', async ({
    page,
    browser,
    seeded,
  }) => {
    await signIn(page, seeded);
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL required for the e2e harness');
    const viewer = await seedSecondUser(url, {
      workspaceId: seeded.workspaceId,
      email: 'p11-viewer@cairn.test',
      password: 'p11-viewer-password-1',
      role: 'viewer',
    });
    const second = await signInSecondUser(browser, {
      email: viewer.email,
      password: viewer.password,
    });
    try {
      const viewerPage = second.page;
      await viewerPage.goto('/settings/account');
      const nav = viewerPage.getByRole('navigation', { name: 'Settings sections' });
      await expect(nav).toBeVisible({ timeout: 15_000 });
      await expect(nav.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
      for (const label of ['Account', 'Security']) {
        await expect(
          nav.getByRole('link', { name: label, exact: true }).locator('svg'),
        ).toHaveCount(1);
      }
    } finally {
      await second.context.close();
    }
  });
});
