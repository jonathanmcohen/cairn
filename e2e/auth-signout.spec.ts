/**
 * Plan E (#70 carry) — sign-out e2e slice.
 * Contract stub. Real assertions land when the e2e suite gains a signed-in fixture.
 * Playwright spec — runs under `pnpm test:a11y`/e2e config, NOT vitest.
 * See docs/superpowers/v0.9.14/plan-E-notifications-settings.md.
 */
import { test } from '@playwright/test';

test.describe('auth sign-out', () => {
  test.fixme(true, 'requires authenticated e2e fixture — stub for v0.9.14 e2e backfill');
  test('signing out clears the session and returns to the sign-in page', async () => {
    // contract: click user menu → Sign out → redirected to /signin, protected route 302s back to /signin
  });
});
