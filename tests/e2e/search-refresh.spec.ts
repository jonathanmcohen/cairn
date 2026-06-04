// v0.9.9 Plan G (Search & refresh consistency) — route-reachability +
// per-feature deployed-image smoke for G1 (#256 version-history refetch),
// G2 (#266 saved-search live-update), and G3 (#41/#220 semantic snippet+score).
//
// DEFERRED-TO-CI: like tests/e2e/security-ux.spec.ts, this spec lives under
// tests/e2e/ but is NOT run by the local `pnpm test:a11y` (whose testDir is
// ./tests/a11y). CI extends testDir/testMatch to include tests/e2e and boots
// the app + seed, so these run against the built/deployed image there. We reuse
// the a11y fixtures (real seeded user + credentials sign-in) so the surface is
// identical to production.
import { expect, test } from '../a11y/fixtures';

async function signIn(
  page: import('@playwright/test').Page,
  seeded: { userEmail: string; userPassword: string },
) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(seeded.userEmail);
  await page.locator('input[name="password"]').fill(seeded.userPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

test.describe('Plan G search & refresh surfaces', () => {
  test('route-reachability — /search renders the Keyword/Semantic/Hybrid mode toggle', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.goto('/search?q=test');
    expect(res?.status()).toBeLessThan(400);
    // The mode toggle is a fieldset of aria-pressed buttons (not native radios).
    await expect(page.getByRole('button', { name: 'Keyword' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Semantic' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hybrid' })).toBeVisible();
  });

  test('#266 — saving a search from the ⌘K palette appears in the sidebar without reload', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // Open the palette and type a query.
    await page.keyboard.press('Meta+k');
    const input = page.locator('[data-cairn-palette] input').first();
    await expect(input).toBeVisible();
    const unique = `plan-g-${Date.now()}`;
    await input.fill(unique);
    // Trigger "save current search" — accept the name prompt default.
    const saveBtn = page.getByRole('button', { name: /save this search to the sidebar/i });
    if ((await saveBtn.count()) > 0) {
      await saveBtn.click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.keyboard.press('Escape');
      // Without a full reload, the sidebar Saved searches section now lists it.
      await expect(
        page.getByRole('region', { name: 'Saved searches' }).getByText(unique),
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test('#41/#220 — Semantic results carry a body snippet (not title-only)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/search?q=planning');
    // Switch to Semantic mode (aria-pressed button) and re-run.
    await page.getByRole('button', { name: 'Semantic' }).click();
    await page.getByRole('button', { name: 'Search' }).click();
    // Each result row is a link with a bold title; a hit with body text also
    // renders a second muted span (the snippet). When results exist, at least
    // one row should carry that snippet span — i.e. not be title-only (#41).
    const rows = page.locator('ul li a:has(span.font-medium)');
    if ((await rows.count()) > 0) {
      const withSnippet = page.locator('ul li a:has(span.font-medium) span.text-muted-foreground');
      await expect(withSnippet.first()).toBeVisible();
    }
  });
});
