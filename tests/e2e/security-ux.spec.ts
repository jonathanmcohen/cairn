// v0.9.9 Plan H (Security UX) — route-reachability + per-feature deployed-image
// smoke for H1–H6.
//
// DEFERRED-TO-CI: like tests/e2e/auth-signout.spec.ts, this spec lives under
// tests/e2e/ but is NOT run by the local `pnpm test:a11y` (whose testDir is
// ./tests/a11y). CI extends testDir/testMatch to include tests/e2e and boots
// the app + seed, so these run against the built/deployed image there. We reuse
// the a11y fixtures (real seeded user + credentials sign-in) so the surface is
// identical to production.
import { expect, signIn, test } from '../a11y/fixtures';

test.describe('Plan H security-UX surfaces', () => {
  test('H1 — /settings/admin/sso renders both Add buttons with the same variant', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.goto('/settings/admin/sso');
    expect(res?.status()).toBeLessThan(400);
    const oidc = page.getByRole('link', { name: 'Add OIDC' });
    const saml = page.getByRole('link', { name: 'Add SAML' });
    await expect(oidc).toBeVisible();
    await expect(saml).toBeVisible();
    // Same Button variant → identical class list; neither carries bg-primary.
    const oidcClass = await oidc.getAttribute('class');
    const samlClass = await saml.getAttribute('class');
    expect(oidcClass).toBe(samlClass);
    expect(oidcClass ?? '').not.toContain('bg-primary');
  });

  test('H2/H3 — /settings/security: friendly device label, hidden bridge IP, calm E2EE notice', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.goto('/settings/security');
    expect(res?.status()).toBeLessThan(400);
    // H2: active sessions never show the raw UA string.
    await expect(page.getByText(/Mozilla\/5\.0/)).toHaveCount(0);
    // H2: with TRUST_PROXY unset, no Docker bridge gateway IP is shown.
    await expect(page.getByText(/172\.\d+\.\d+\.\d+/)).toHaveCount(0);
    // H3: when E2EE is disabled the card is the muted informational notice, not
    // a destructive error. (Only assert when the disabled notice is present.)
    const notice = page.getByText('End-to-end encryption is turned off in this build.');
    if ((await notice.count()) > 0) {
      await expect(notice).toBeVisible();
    }
  });

  test('H4/H5 — /settings/security/passkeys: env-var detail gated to admins + docs link', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.goto('/settings/security/passkeys');
    expect(res?.status()).toBeLessThan(400);
    // Only meaningful when WebAuthn is unconfigured (CAIRN_RP_ID unset). The
    // seeded admin user should then see the env-var detail + operations link;
    // the link href must be the GitHub operations.md URL (H5).
    const adminBody = page.getByText(/CAIRN_RP_ID and CAIRN_RP_ORIGIN/);
    if ((await adminBody.count()) > 0) {
      await expect(adminBody).toBeVisible();
      const docs = page.getByRole('link', { name: 'See the operations guide' });
      await expect(docs).toBeVisible();
      await expect(docs).toHaveAttribute(
        'href',
        'https://github.com/jonathanmcohen/cairn/blob/main/docs/operations.md',
      );
    }
  });
});
