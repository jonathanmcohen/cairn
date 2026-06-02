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
    // Drive the real credentials form so we hold a genuine Auth.js jwt cookie.
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(seeded.userEmail);
    await page.locator('input[name="password"]').fill(seeded.userPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/', { timeout: 30_000 });

    // The sidebar footer "Sign out" submits a Server Action (no CSRF-less POST
    // to /api/auth/signout). After it resolves we must land on /login.
    await page
      .getByRole('button', { name: /sign out/i })
      .first()
      .click();
    await page.waitForURL('**/login', { timeout: 30_000 });
    expect(page.url()).toContain('/login');

    // Session is actually cleared: a protected route bounces back to login.
    await page.goto('/');
    await page.waitForURL('**/login', { timeout: 30_000 });
    expect(page.url()).toContain('/login');
  });

  test('GET /logout signs out and redirects to /login', async ({ page, seeded }) => {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(seeded.userEmail);
    await page.locator('input[name="password"]').fill(seeded.userPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/', { timeout: 30_000 });

    await page.goto('/logout');
    await page.waitForURL('**/login', { timeout: 30_000 });
    expect(page.url()).toContain('/login');
  });
});
