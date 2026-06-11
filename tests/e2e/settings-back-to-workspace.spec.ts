// Post-v0.10.0 fix — the E5 settings refactor unmounts the workspace sidebar
// on /settings/*, and every SettingsSidebar target stayed inside /settings:
// the settings hub had NO route back to the app. The settings nav now leads
// with a "Back to workspace" link.
import { expect, signIn, test } from '../a11y/fixtures';

const BACK_LINK = '[data-testid="settings-back-to-workspace"]';

test.describe('settings — back to workspace', () => {
  test('the settings nav leads with a back link that leaves /settings', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/account');
    const back = page.locator(BACK_LINK);
    await expect(back).toBeVisible({ timeout: 15_000 });

    await back.click();
    // '/' redirects to the landing page; the workspace chrome (sidebar)
    // mounting again is the proof we left the settings shell.
    await expect(page).not.toHaveURL(/\/settings/, { timeout: 15_000 });
    await expect(page.locator('[data-cairn-workspace-sidebar]')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('the back link is present on admin settings pages too', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/oauth-clients');
    await expect(page.locator(BACK_LINK)).toBeVisible({ timeout: 15_000 });
  });
});
