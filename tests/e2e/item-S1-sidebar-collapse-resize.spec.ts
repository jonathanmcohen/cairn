// v0.10.2 S1 — sidebar collapse toggle (Mod+\), 56px rail, 56–400 resize bounds.
//
// Behavior under guard: a global Mod+\ shortcut (src/components/shortcuts/
// app-shortcuts.ts, id sidebar.toggle) toggles a persistent collapsed state
// (root class cairn-sidebar-collapsed, localStorage cairn:sidebar-collapsed)
// that renders the workspace aside as a 56px rail on ALL routes — independent
// of focus mode's display:none. Collapse never writes the resize width, so
// restoring returns to the user's prior custom width. Resize bounds moved
// from 200–480 to 56–400 (sidebar-resize-handle.tsx, aria-valuemin/max).
//
// Assertions use the aside's COMPUTED pixel width, not class names — a
// class-only check could false-green against a class the CSS never applies.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';

const ASIDE = '[data-cairn-workspace-sidebar]';

async function asideWidth(page: Page): Promise<number> {
  const box = await page.locator(ASIDE).boundingBox();
  if (!box) throw new Error('sidebar aside not found');
  return box.width;
}

test.describe('item S1 — sidebar collapse + resize bounds', () => {
  test('Mod+\\ collapses to a 56px rail on a non-page route and restores the custom width', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // The focus-mode-only gap is the bug being closed: assert on /inbox, a
    // route where no hide mechanism existed at all.
    await page.goto('/inbox');
    await expect(page.locator(ASIDE)).toBeVisible({ timeout: 30_000 });

    // Resize to a custom 320px first (default 240 + 5 × 16px keyboard steps)
    // so the restore assertion can distinguish "previous custom width" from
    // "default".
    const handle = page.getByRole('separator', { name: 'Resize sidebar' });
    await handle.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(() => asideWidth(page)).toBeCloseTo(320, 0);

    // Collapse: computed width drops to the 56px rail.
    await page.keyboard.press('ControlOrMeta+\\');
    await expect.poll(() => asideWidth(page)).toBeCloseTo(56, 0);

    // Toggle again: the PREVIOUS custom width returns (not the 240 default —
    // collapse must not clobber the persisted resize width).
    await page.keyboard.press('ControlOrMeta+\\');
    await expect.poll(() => asideWidth(page)).toBeCloseTo(320, 0);
  });

  test('collapsed state survives reload (per-device persistence)', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/inbox');
    await expect(page.locator(ASIDE)).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press('ControlOrMeta+\\');
    await expect.poll(() => asideWidth(page)).toBeCloseTo(56, 0);

    await page.reload();
    await expect(page.locator(ASIDE)).toBeAttached({ timeout: 30_000 });
    await expect.poll(() => asideWidth(page), { timeout: 15_000 }).toBeCloseTo(56, 0);

    // Clean up for later tests in this worker: restore expanded.
    await page.keyboard.press('ControlOrMeta+\\');
    await expect.poll(() => asideWidth(page)).toBeGreaterThan(100);
  });

  test('resize clamps at the new 56–400 bounds and reports them via ARIA', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/inbox');
    const handle = page.getByRole('separator', { name: 'Resize sidebar' });
    await expect(handle).toBeVisible({ timeout: 30_000 });
    await expect(handle).toHaveAttribute('aria-valuemin', '56');
    await expect(handle).toHaveAttribute('aria-valuemax', '400');

    await handle.focus();
    await page.keyboard.press('End');
    await expect.poll(() => asideWidth(page)).toBeCloseTo(400, 0);

    await page.keyboard.press('Home');
    await expect.poll(() => asideWidth(page)).toBeCloseTo(56, 0);

    // Restore the default for subsequent specs sharing the persisted width.
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(() => asideWidth(page)).toBeCloseTo(248, 0);
  });
});
