// A1 (#80, P0 security) — sign-out restore e2e.
//
// DEFERRED-TO-CI: this spec lives under tests/e2e/ per the v0.9.9 Plan A path.
// The booted-app Playwright harness (fixtures + webServer + seed) lives under
// tests/a11y/ and is wired by `playwright.config.ts` (testDir: ./tests/a11y).
// CI runs this file by extending `testMatch`/`testDir` to include tests/e2e;
// locally it is NOT executed by `pnpm test:a11y` as-shipped. We reuse the
// a11y fixtures (real seeded user + credentials sign-in) so the assertion path
// is identical to the live surface.
import { expect, test } from '../a11y/fixtures';

test.describe('sign-out (#80, P0 security)', () => {
  test('clicking "Sign out" clears the session and redirects to /login', async ({
    page,
    seeded,
  }) => {
    // H2 hermetic rewrite. Root cause of the old deterministic red (H1
    // quarantine): the sign-in wait was the soft glob `waitForURL('**/')`,
    // which resolved at the TRANSIENT '/' — the app then redirects '/' to the
    // first/landing page (resolveLandingPage; always, now that the dev DB has
    // pages), so the Sign-out click fired mid-navigation and was swallowed by
    // the in-flight redirect; the test then waited on /login forever. The
    // product path was never broken (verified: the Server Action POST answers
    // 303 → /login). Hermetic = settle on a REAL post-login state (predicate
    // + hydrated sidebar) before interacting.
    // Drive the real credentials form so we hold a genuine Auth.js jwt cookie.
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(seeded.userEmail);
    await page.locator('input[name="password"]').fill(seeded.userPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
    // Settled: the workspace sidebar (which hosts the Sign-out form) is
    // mounted and the landing-page redirect chain has finished.
    await expect(page.locator('[data-cairn-workspace-sidebar]')).toBeVisible({
      timeout: 30_000,
    });

    // The sidebar footer "Sign out" submits a Server Action (no CSRF-less POST
    // to /api/auth/signout). Its redirect arrives as a SOFT same-document RSC
    // navigation — no new `load` event ever fires, so `waitForURL(...,
    // waitUntil: 'load')` (the old assert, and waitForURL's default) hangs for
    // the full timeout even though the page IS on /login. Assert the URL with
    // the lifecycle-agnostic toHaveURL instead. (This soft-nav-vs-load
    // mismatch was the entire flake history of this test.)
    await page
      .locator('[data-cairn-workspace-sidebar]')
      .getByRole('button', { name: /sign out/i })
      .click();
    // v0.10.2 S11 — Sign out now opens a confirm dialog first (a stray click
    // can't end the session). Confirm it to proceed to the real Server Action.
    const confirm = page.getByRole('dialog', { name: 'Sign out?' });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    // Session is actually cleared: a protected route bounces back to login —
    // and THIS is the hard-document-navigation proof (goto follows the
    // redirect chain and completes a real load).
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  });

  test('GET /logout signs out and redirects to /login', async ({ page, seeded }) => {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(seeded.userEmail);
    await page.locator('input[name="password"]').fill(seeded.userPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // not-'/login' predicate: '/' redirects to the landing page when the
    // workspace has pages, so a '**/' glob can miss the transient root (H1).
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

    await page.goto('/logout');
    await page.waitForURL('**/login', { timeout: 30_000 });
    expect(page.url()).toContain('/login');
  });
});
