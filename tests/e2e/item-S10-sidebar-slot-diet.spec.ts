// v0.10.2 S10 — sidebar slot diet: Templates → Cmd-K palette, Replay-tour →
// a footer "?" Help menu.
//
// Behavior under guard:
//   - The Templates row and the standalone Replay-tour row are GONE from the
//     footer nav.
//   - The onboarding tour still runs to its FINAL step, whose spotlight
//     anchors on the new "?" Help trigger (`data-tour="help"` re-anchored) —
//     the last step's card ("Take the tour again") renders instead of the
//     walker stranding on a removed row. This is the assertion a false-green
//     spec (rows-gone-but-anchor-dangles) would miss.
//   - /templates is still reachable via the Cmd-K palette action
//     "Open templates gallery" (real navigation).
//   - The "?" Help menu opens (keyboard) and contains Replay tour / Keyboard
//     shortcuts / What's new; "Replay tour" restarts the tour.
//   - The bare `?` shortcut still opens the shortcuts sheet (no regression).
//
// RED on pre-fix: Templates + standalone Replay-tour rows present, no "?"
// Help button — the auto-start tour's last step still anchors on the old row.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';

const TOUR = '[data-tour-dialog]';
const HELP_STEP_TITLE = 'Take the tour again'; // tour.step.help.title — the LAST step
const help = (page: Page) =>
  page.locator('[data-cairn-workspace-sidebar]').last().getByRole('button', { name: 'Help' });

test.describe('item S10 — sidebar slot diet', () => {
  test('rows diet`d; tour reaches the re-anchored last step; palette + Help-menu fallbacks', async ({
    page,
    seeded,
  }) => {
    // Don't suppress the tour — drive the real auto-start path so the
    // re-anchored final step is exercised.
    await signIn(page, seeded, { tour: 'fresh' });
    await page.goto(`/pages/${seeded.pageId}`);

    await expect(help(page)).toBeVisible({ timeout: 30_000 });

    // --- Both diet'd rows are gone from the footer. ---
    await expect(page.getByRole('link', { name: 'Templates' })).toHaveCount(0);
    // No standalone Replay-tour row: its label now lives ONLY in the (closed)
    // Help menu.
    await expect(page.getByRole('button', { name: 'Replay tour' })).toHaveCount(0);

    // --- The auto-started tour walks Next to its LAST step, which anchors on
    //     the new Help button. Reaching the "Take the tour again" card proves
    //     `data-tour="help"` re-anchored (a dangling anchor strands the walker
    //     before this step). ---
    const tour = page.locator(TOUR);
    await expect(tour).toBeVisible({ timeout: 15_000 });
    let reachedHelpStep = false;
    for (let i = 0; i < 12; i++) {
      if (
        await tour
          .getByRole('heading', { name: HELP_STEP_TITLE })
          .isVisible()
          .catch(() => false)
      ) {
        reachedHelpStep = true;
        break;
      }
      const next = tour.getByRole('button', { name: 'Next', exact: true });
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await page.waitForTimeout(250);
    }
    expect(reachedHelpStep, 'tour reached its re-anchored final step').toBe(true);
    await tour.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(tour).toHaveCount(0);

    // --- /templates still reachable via the Cmd-K palette action. ---
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.locator('[data-cairn-palette]');
    await expect(palette).toBeVisible({ timeout: 10_000 });
    await palette.getByText('Open templates gallery', { exact: false }).first().click();
    await page.waitForURL(/\/templates(\/|$|\?)/, { timeout: 15_000 });

    await page.goto(`/pages/${seeded.pageId}`);
    await expect(help(page)).toBeVisible({ timeout: 30_000 });

    // --- Help menu opens via keyboard and lists all three items. ---
    await help(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Replay tour' })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: "What's new" })).toBeVisible();

    // "Replay tour" restarts the tour (observable first step).
    await page.getByRole('menuitem', { name: 'Replay tour' }).click();
    await expect(page.locator(TOUR)).toBeVisible({ timeout: 10_000 });
    await page.locator(TOUR).getByRole('button', { name: 'Skip tour' }).click();
    await expect(page.locator(TOUR)).toHaveCount(0);

    // --- Bare `?` still opens the shortcuts sheet (no dispatcher regression). ---
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
