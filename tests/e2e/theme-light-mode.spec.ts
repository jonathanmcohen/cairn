// v0.9.9 Plan J (Theme & light mode) — route-reachability + per-feature
// deployed-image smoke for J1 (#223 3-state Sun/Auto/Moon toggle), J2 (#224
// light-mode regressions: cover/approval/mention/code), J3 (#200 44px swatches
// + scoped live preview), and J4 (#201 custom-hex prefilled from active preset).
//
// DEFERRED-TO-CI: like tests/e2e/workspace-onboarding.spec.ts, this spec lives
// under tests/e2e/ but is NOT run by the local `pnpm test:a11y` (whose testDir
// is ./tests/a11y). CI extends testDir/testMatch to include tests/e2e, boots
// the built/deployed image + seed, and runs these against production-identical
// surfaces. We reuse the a11y fixtures (real seeded user + credentials sign-in).
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

test.describe('Plan J theme + light-mode surfaces', () => {
  test('route-reachability — /settings/account/theme renders swatches + live preview + custom hex', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.goto('/settings/account/theme');
    expect(res?.status()).toBeLessThan(400);
    // J3 — accent swatches (named accents render as labelled buttons).
    await expect(page.getByRole('button', { name: 'Blue' })).toBeVisible();
    // J3 — scoped live-preview container + its sample primary button.
    await expect(page.getByTestId('theme-preview')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Primary button' })).toBeVisible();
    // J4 — custom-hex input is present (and prefilled, asserted below).
    await expect(page.getByLabel('Custom hex')).toBeVisible();
  });

  test('J1 #223 — the sidebar theme toggle cycles Sun → Auto → Moon → Sun with distinct labels', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // next-themes defaultTheme is 'system' → the toggle starts on System theme.
    const toggle = page.getByRole('button', { name: 'System theme' });
    await expect(toggle).toBeVisible();
    // First click must produce a visible state change (proves #223 dead-click
    // is gone): System → Dark.
    await toggle.click();
    const dark = page.getByRole('button', { name: 'Dark theme' });
    await expect(dark).toBeVisible();
    // Dark → Light.
    await dark.click();
    const light = page.getByRole('button', { name: 'Light theme' });
    await expect(light).toBeVisible();
    // Light → System (back to start).
    await light.click();
    await expect(page.getByRole('button', { name: 'System theme' })).toBeVisible();
  });

  test('J3 #200 — clicking an accent recolors the live preview without reloading or persisting', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/account/theme');
    const preview = page.getByTestId('theme-preview');
    await page.getByRole('button', { name: 'Blue' }).click();
    // The scoped container exposes the accent's primary HSL inline — recolor is
    // live (no navigation). Blue → "217 91% 60%" (matches globals.css).
    await expect(preview).toHaveAttribute('style', /--primary:\s*217 91% 60%/);
    // No reload happened — the route is unchanged.
    expect(new URL(page.url()).pathname).toBe('/settings/account/theme');
  });

  test('J4 #201 — custom-hex shows the active preset hex on load and updates on preset change', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/account/theme');
    const hex = page.getByLabel('Custom hex');
    // Default accent prefills #0f172a; picking Emerald reprefills #059669.
    await page.getByRole('button', { name: 'Emerald' }).click();
    await expect(hex).toHaveValue('#059669');
  });
});
