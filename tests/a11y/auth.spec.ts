import { DARK_INIT } from '../../playwright.config';
import { expectNoA11yViolations } from './axe';
import { expect, test } from './fixtures';

// Mirror shell.spec.ts: the `dark` project pre-seeds class-based dark mode.
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

test.describe('sign-in screen a11y (WCAG 2.1 AA)', () => {
  test('the sign-in screen has no violations', async ({ page }) => {
    await page.goto('/login');
    // Visible labelled inputs and a labelled submit button.
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expectNoA11yViolations(page, 'sign-in');
  });
});
