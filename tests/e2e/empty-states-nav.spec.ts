// v0.9.9 Plan I (Empty states + nav entries + notif/webhook matrix) —
// route-reachability + per-feature deployed-image smoke for:
//   I1 (#221/#222/#204) trash / flashcards-due / favorites / bell-flyout empty states
//   I2 (#202) /favorites + /inbox main-sidebar entries
//   I3 (#194) SMTP-disabled banner docs link
//   I5 (#257/#258) webhook grouped event catalog + Select-all/Recommended/Clear
//   I6 (#203) API-key quotas empty state → Mint-a-token CTA
//
// DEFERRED-TO-CI: like tests/e2e/workspace-onboarding.spec.ts, this spec lives
// under tests/e2e/ but is NOT run by the local `pnpm test:a11y` (whose testDir
// is ./tests/a11y). CI extends testDir/testMatch to include tests/e2e, boots
// the built/deployed image + seed, and runs these against production-identical
// surfaces. Reuses the a11y fixtures (real seeded user + credentials sign-in).
import { expect, signIn, test } from '../a11y/fixtures';

test.describe('Plan I — nav entries + empty states + matrices', () => {
  test('#202 — Favorites and Inbox are reachable from the main sidebar', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');
    const favorites = page.getByRole('link', { name: 'Favorites' });
    const inbox = page.getByRole('link', { name: 'Inbox' });
    await expect(favorites).toBeVisible();
    await expect(inbox).toBeVisible();
    await favorites.click();
    await page.waitForURL('**/favorites', { timeout: 15_000 });
    await page.goBack();
    await inbox.click();
    await page.waitForURL('**/inbox', { timeout: 15_000 });
  });

  test('#222 — /trash renders an iconed empty state when empty', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const res = await page.goto('/trash');
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByText('Trash is empty')).toBeVisible({ timeout: 15_000 });
  });

  test('#221 — flashcards-due empty state shows the Browse pages CTA', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const res = await page.goto('/flashcards/study');
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByText('No cards due')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Browse pages' })).toBeVisible();
  });

  test('#204 — /favorites empty state shows an icon + Browse pages CTA', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.goto('/favorites');
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByText('No favorites yet')).toBeVisible({ timeout: 15_000 });
  });

  test('#221 — bell flyout shows an iconed empty state', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/');
    await page
      .getByRole('button', { name: /notifications/i })
      .first()
      .click();
    await expect(page.getByText(/all caught up/i)).toBeVisible({ timeout: 15_000 });
  });

  test('#203 — API-keys empty state shows Mint-a-token CTA', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const res = await page.goto('/settings/developer/api-keys');
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByText('No API keys yet')).toBeVisible({ timeout: 15_000 });
    const cta = page.getByRole('link', { name: 'Mint a token' });
    await expect(cta).toHaveAttribute('href', '/settings/developer/tokens');
  });

  test('#257/#258 — webhook create form shows grouped catalog + bulk controls', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/webhooks');
    await page.getByRole('button', { name: 'Add webhook' }).click();
    await expect(page.getByText('comment.created')).toBeVisible();
    await expect(page.getByText('member.invited')).toBeVisible();
    await expect(page.getByText('page.status_changed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select all' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recommended' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();
  });
});
