// v0.9.9 Plan T (Comments) — route-reachability + per-feature deployed-image
// smoke for T1 (#74/#255): inline edit affordance on the author's own comment.
//
// DEFERRED-TO-CI: like tests/e2e/empty-states-nav.spec.ts, this spec lives under
// tests/e2e/ but is NOT run by the local `pnpm test:a11y` (whose testDir is
// ./tests/a11y). CI extends testDir/testMatch to include tests/e2e, boots the
// built/deployed image + seed, and runs these against production-identical
// surfaces. Reuses the a11y fixtures (real seeded user + credentials sign-in).
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

// Open the first seeded page and reveal its comment panel. The panel is the
// `aside` rendered by CommentPanel; the trigger is the comments toggle in the
// page action bar.
async function openFirstPageComments(page: import('@playwright/test').Page) {
  // Navigate to a page via the sidebar tree; the first PAGES tree link is a page.
  const firstPage = page.locator('[data-page-tree] a, nav a[href^="/pages/"]').first();
  await firstPage.click();
  await page.waitForURL('**/pages/**', { timeout: 20_000 });
  // Toggle the comments panel open.
  await page
    .getByRole('button', { name: /comments/i })
    .first()
    .click();
}

test.describe('Plan T — comment edit affordance (#74/#255)', () => {
  test('comment panel renders as an aside', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await openFirstPageComments(page);
    await expect(page.locator('aside')).toBeVisible({ timeout: 15_000 });
  });

  test('author edits own comment inline and sees the (edited) marker', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await openFirstPageComments(page);

    // Add a comment as the author so we have one we are allowed to edit.
    const composer = page.locator('aside [contenteditable="true"]').first();
    await composer.click();
    await composer.type('typpo comment');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByText('typpo comment')).toBeVisible({ timeout: 15_000 });

    // The author sees the Edit pencil; click it, fix the body, Save.
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    const editor = page.locator('aside textarea').first();
    await editor.fill('typo fixed');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('typo fixed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('(edited)')).toBeVisible();
  });
});
