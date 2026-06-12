// v0.10.2 P14 — template gallery "Use template" timeout + error toast + retry.
//
// Behavior under guard: TemplatesGallery.onUse (src/components/templates/
// templates-gallery.tsx) wraps the instantiate fetch in an AbortController
// with a 10s timeout and surfaces failures through the app-wide sonner
// Toaster with a Retry action, in addition to the pre-existing inline
// destructive <p>. This spec drives the real gallery through the proxy with
// route interception:
//   - stalled request → abort fires at 10s, timeout toast appears, the
//     button label resets (B1's finally observed);
//   - the toast's Retry re-fires the request with the route unblocked and
//     the template actually applies (navigation to the minted page) — a
//     markup-only assertion would false-green a Retry that never re-fires;
//   - server 500 → toast carries the server's error message (not only the
//     inline <p>);
//   - fast success → no toast, normal post-use navigation.
import { expect, signIn, test } from '../a11y/fixtures';

const INSTANTIATE = '**/api/templates/*/instantiate';
const TIMEOUT_COPY = 'Using the template took too long and was cancelled. Try again.';

test.describe('item P14 — template use timeout, toast, retry', () => {
  test('stalled instantiate aborts at 10s, toasts, and Retry completes the flow', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    // Stall every instantiate call: never fulfill, let the client abort.
    let stalled = 0;
    await page.route(INSTANTIATE, () => {
      stalled += 1;
    });

    await page.goto('/templates');
    const use = page.getByTestId('template-use').first();
    await expect(use).toBeVisible({ timeout: 30_000 });
    await use.click();
    await expect(use).toHaveText('Working…');

    // The 10s client-side abort fires; toast carries the timeout copy and the
    // button releases (B1's finally) instead of stranding on "Working…".
    const toast = page.locator('[data-sonner-toast]', { hasText: TIMEOUT_COPY });
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await expect(use).toHaveText('Use template');
    expect(stalled).toBe(1);

    // Unblock the route, then drive the toast's Retry — the second request
    // must actually fire and the normal post-use navigation must complete.
    await page.unroute(INSTANTIATE);
    await toast.getByRole('button', { name: 'Retry' }).click();
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}/, { timeout: 30_000 });
  });

  test('server 500 surfaces the error in a toast, not only the inline error', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const marker = `P14 boom ${Date.now()}`;
    await page.route(INSTANTIATE, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: marker }),
      }),
    );

    await page.goto('/templates');
    const use = page.getByTestId('template-use').first();
    await expect(use).toBeVisible({ timeout: 30_000 });
    await use.click();

    await expect(page.locator('[data-sonner-toast]', { hasText: marker })).toBeVisible({
      timeout: 15_000,
    });
    // Inline destructive error keeps rendering too.
    await expect(page.locator('p.text-destructive', { hasText: marker })).toBeVisible();
    await expect(use).toHaveText('Use template');
    await expect(use).toBeEnabled();
  });

  test('fast success path navigates with no toast', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/templates');
    const use = page.getByTestId('template-use').first();
    await expect(use).toBeVisible({ timeout: 30_000 });
    await use.click();
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
});
