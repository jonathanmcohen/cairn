// v0.9.19 A5 (#5) — the bare /settings/admin route must (1) respond directly
// with its landing page (not a 3xx) and (2) carry Cache-Control: no-store so a
// browser can never cache it as the permanently-cacheable 308 that pre-v0.9.18
// builds emitted (→ /settings/workspace/members) — the live miss where the new
// admin index stayed unreachable for upgraded users.
import { expect, signIn, test } from '../a11y/fixtures';

test.describe('item #5 — /settings/admin is never cacheable', () => {
  test('responds 200 with no-store and renders the admin landing page', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    // Capture the top-level document response for the bare admin route.
    const res = await page.goto('/settings/admin');
    expect(res, 'navigation produced a response').not.toBeNull();
    // Direct render — NOT a redirect to /settings/workspace/members.
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/settings/admin');

    // The response must forbid caching so a stale 308 can't shadow it.
    const cacheControl = res?.headers()['cache-control'] ?? '';
    expect(cacheControl).toContain('no-store');

    // The real landing page rendered (admin cards, not the members table).
    await expect(page.getByRole('link', { name: /audit/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
