// v0.10.0 Plan F F3 — onboarding tour (element-anchored walkthrough).
//
// A lightweight anchored-popover tour (src/components/tour/) points at real UI
// via stable `data-tour` hooks (sidebar, ⌘K search, topbar actions, page menu,
// help/replay). It auto-starts once per workspace — the seen-marker is
// localStorage `cairn:tour-seen:<workspaceId>` = TOUR_VERSION — and can be
// replayed anytime from the sidebar-footer "?" Help menu's "Replay tour" item
// (v0.10.2 S10 folded the standalone Replay-tour row into that menu), which
// dispatches the `cairn:start-tour` CustomEvent.
//
// Harness note: every OTHER spec gets the tour suppressed by the shared signIn
// fixture (wildcard seen-marker via addInitScript — see tests/a11y/fixtures.ts).
// This spec opts out with `{ tour: 'fresh' }`: a fresh Playwright context has
// empty localStorage, which IS the first-run condition. The seeded a11y user
// has existing pages, so the v0.8 onboarding WIZARD never shows here and the
// tour's wizard-gate lets it auto-start.
//
// RED on the old build: no tour component exists — no [data-tour-dialog] ever
// appears, and the sidebar footer has no "Replay tour" button.
import { expect, signIn, test } from '../a11y/fixtures';

// Exact en copy from messages/en.json (the e2e harness runs the en locale).
const SIDEBAR_TITLE = 'Your workspace';
const SEARCH_TITLE = 'Find anything fast';
const TOPBAR_TITLE = 'Notifications and more';
const PAGE_MENU_TITLE = 'Share your work';
const HELP_TITLE = 'Take the tour again';

const DIALOG = '[data-tour-dialog]';
const HIGHLIGHT = '[data-tour-highlight]';

test.describe('item F3 — onboarding tour (element-anchored walkthrough)', () => {
  test('(a) first run anchors step 1 to the sidebar; Next advances; Done sets the seen-marker so reload does not re-show', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded, { tour: 'fresh' });
    await page.goto('/');

    // Step 1 — anchored to the real sidebar element.
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(SIDEBAR_TITLE);

    // The highlight overlay box tracks the sidebar anchor's rect…
    const aside = page.locator('[data-tour="sidebar"]');
    await expect(page.locator(HIGHLIGHT)).toBeVisible();
    const anchorBox = await aside.boundingBox();
    const highlightBox = await page.locator(HIGHLIGHT).boundingBox();
    expect(anchorBox).not.toBeNull();
    expect(highlightBox).not.toBeNull();
    if (anchorBox && highlightBox) {
      expect(Math.abs(highlightBox.x - anchorBox.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(highlightBox.width - anchorBox.width)).toBeLessThanOrEqual(8);
    }
    // …and the card sits to the RIGHT of the sidebar (placement: 'right').
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    if (anchorBox && dialogBox) {
      expect(dialogBox.x).toBeGreaterThanOrEqual(anchorBox.x + anchorBox.width - 1);
    }

    // Next through every mounted step. '/' redirects to the first/landing
    // PAGE (resolveLandingPage), so ALL five anchors are mounted here —
    // sidebar → search → topbar → page-menu → help. The missing-anchor skip
    // is covered by test (d) on /inbox.
    const next = dialog.getByRole('button', { name: 'Next', exact: true });
    await next.click();
    await expect(dialog).toContainText(SEARCH_TITLE);
    await next.click();
    await expect(dialog).toContainText(TOPBAR_TITLE);
    await next.click();
    await expect(dialog).toContainText(PAGE_MENU_TITLE);
    await next.click();
    await expect(dialog).toContainText(HELP_TITLE);

    // Last mounted step shows Done; Done dismisses AND sets the seen-marker.
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);

    // Reload in the SAME context (marker persisted) → no tour.
    await page.reload();
    await expect(page.locator('[data-tour="sidebar"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(page.locator(HIGHLIGHT)).toHaveCount(0);
  });

  test('(b) prefers-reduced-motion: the tour still opens, advances and dismisses', async ({
    page,
    seeded,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page, seeded, { tour: 'fresh' });
    await page.goto('/');

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(SIDEBAR_TITLE);

    // Transitions are motion-reduce:transition-none — stepping is instant and
    // the popover remains fully driveable.
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText(SEARCH_TITLE);

    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);
  });

  test('(c) keyboard: Tab is trapped in the popover, Enter drives Next, Esc dismisses and sets the seen-marker', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded, { tour: 'fresh' });
    await page.goto('/');

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(SIDEBAR_TITLE);
    // The popover card takes focus on open.
    await expect(dialog).toBeFocused();

    const skip = dialog.getByRole('button', { name: 'Skip tour', exact: true });
    const next = dialog.getByRole('button', { name: 'Next', exact: true });

    // Tab cycles forward through the card's controls (step 1 has no Back):
    // card → Skip → Next → wraps to Skip; Shift+Tab walks back to Next.
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(next).toBeFocused();

    // Enter activates the focused Next button → step 2.
    await page.keyboard.press('Enter');
    await expect(dialog).toContainText(SEARCH_TITLE);

    // Esc = skip/dismiss, which marks the tour seen…
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);

    // …so a reload does NOT re-show it.
    await page.reload();
    await expect(page.locator('[data-tour="sidebar"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(DIALOG)).toHaveCount(0);
  });

  test('(d) a step whose anchor is not mounted is SKIPPED, not stuck: page-menu is absent on the inbox route', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded, { tour: 'fresh' });
    // NOT '/' — the workspace home redirects to the first/landing PAGE
    // (resolveLandingPage), which mounts the page menu and defeats the
    // missing-anchor scenario. /inbox keeps the app chrome (sidebar, search,
    // topbar, help) without any page menu.
    await page.goto('/inbox');

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(SIDEBAR_TITLE);

    // Sanity: the page-menu anchor really is unmounted on this route —
    // that is what makes the skip below meaningful.
    await expect(page.locator('[data-tour="page-menu"]')).toHaveCount(0);

    // The step counter totals MOUNTED steps only: 4 of the 5 declared steps
    // (sidebar, search, topbar, help) — the skipped page-menu leaves no hole.
    await expect(dialog).toContainText('1 / 4');

    const next = dialog.getByRole('button', { name: 'Next', exact: true });
    await next.click();
    await expect(dialog).toContainText(SEARCH_TITLE);
    await next.click();
    await expect(dialog).toContainText(TOPBAR_TITLE);
    await expect(dialog).toContainText('3 / 4');

    // Stepping from topbar goes DIRECTLY to the help step — the page-menu
    // step (between them in STEPS) never renders detached or wedges the tour.
    await next.click();
    await expect(dialog).toContainText(HELP_TITLE);
    await expect(dialog).toContainText('4 / 4');
    await expect(dialog).not.toContainText(PAGE_MENU_TITLE);

    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
  });

  test('(e) the Help menu "Replay tour" item replays the tour even after the seen-marker is set', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded, { tour: 'fresh' });
    await page.goto('/');

    // Dismiss the auto-started first run → seen-marker set.
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);

    // Reload proves the marker took (no auto-show)…
    await page.reload();
    await expect(page.locator('[data-tour="sidebar"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(DIALOG)).toHaveCount(0);

    // …then the sidebar-footer Help menu's "Replay tour" item re-triggers
    // regardless of it (v0.10.2 S10 moved Replay tour off a standalone footer
    // row into the "?" Help dropdown). Scope to the desktop aside: the mobile
    // drawer also renders the footer nav when open, so the bare selector could
    // be ambiguous.
    await page
      .locator('[data-cairn-workspace-sidebar]')
      .last()
      .getByRole('button', { name: 'Help' })
      .click();
    await page.getByRole('menuitem', { name: 'Replay tour' }).click();
    await expect(page.locator(DIALOG)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(DIALOG)).toContainText(SIDEBAR_TITLE);
  });
});
