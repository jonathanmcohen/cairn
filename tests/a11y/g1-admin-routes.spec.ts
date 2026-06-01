import { DARK_INIT } from '../../playwright.config';
import { expectNoA11yViolations } from './axe';
import { expect, signIn, test } from './fixtures';

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

test.describe('G1 admin IA (audit items A, B)', () => {
  test('Admin sidebar parent navigates to the audit page', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/account');
    // The seeded user is workspace owner → admin-gated nav is visible.
    await page.getByRole('link', { name: 'Admin', exact: true }).click();
    await page.waitForURL('**/settings/admin/audit');
    expect(page.url()).toContain('/settings/admin/audit');
  });

  test('legacy /admin/sso redirects into the settings hub', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/admin/sso');
    await page.waitForURL('**/settings/admin/sso');
    expect(page.url()).toContain('/settings/admin/sso');
    await expect(page.getByRole('heading', { name: 'Single sign-on' })).toBeVisible();
  });

  test('legacy SSO deep link redirects with the path preserved', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/admin/sso/oidc/new');
    await page.waitForURL('**/settings/admin/sso/oidc/new');
    expect(page.url()).toContain('/settings/admin/sso/oidc/new');
  });

  test('/settings/admin/federated is axe-clean', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/federated');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Federated search' })).toBeVisible();
    await expectNoA11yViolations(page, '/settings/admin/federated');
  });

  test('/settings/admin/users is axe-clean', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/users');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await expectNoA11yViolations(page, '/settings/admin/users');
  });
});
