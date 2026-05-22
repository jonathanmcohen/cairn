import { DARK_INIT } from '../../playwright.config';
import { expectNoA11yViolations } from './axe';
import { expect, signIn, test } from './fixtures';

// Force the class-based dark theme before any page script runs for the `dark`
// project, matching shell.spec.ts. The app's theme is `next-themes` CLASS-based
// (CLAUDE.md), so a plain `colorScheme: 'dark'` is insufficient.
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

test.describe('share / page-actions dialog a11y (WCAG 2.1 AA)', () => {
  test('opens, axe-clean, Esc closes + restores focus to the trigger', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);
    // Wait for the network to settle so the editor + page-menu trigger mount.
    await page.waitForLoadState('networkidle');

    // The share/publish surface in this repo is the per-page actions popover,
    // which contains "Publish to web" / "Unpublish" + the SharePanel form for
    // duplication / password / expiry. The trigger is the icon button labelled
    // "Page menu" sitting in the page header (P7 + P14 T2 labelling).
    const trigger = page.getByRole('button', { name: 'Page menu' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    // The popover is exposed as `role="dialog"` with an accessible name
    // ("Page actions" via a visually-hidden heading).
    const dialog = page.getByRole('dialog', { name: 'Page actions' });
    await expect(dialog).toBeVisible();

    // Axe on the open dialog surface — fails on any WCAG 2.1 AA violation.
    await expectNoA11yViolations(page, 'page-actions dialog');

    // Esc closes the dialog and restores focus to the trigger button.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
