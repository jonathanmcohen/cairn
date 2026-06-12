// v0.10.2 P16 — workspace-switcher dropdown tracks the trigger width.
//
// Behavior under guard: DropdownMenu.Content in
// src/components/workspace-switcher.tsx sizes itself from Radix's
// --radix-dropdown-menu-trigger-width var (with a min-w-56 floor) instead of
// the old fixed w-56 (224px), so the menu follows the user-resized sidebar.
// This spec measures Content vs Trigger bounding boxes at the default
// sidebar width, then resizes the sidebar through the REAL resize handle
// (End → 480px max, Home → 200px min) and re-measures — a fixed-width
// regression passes at most one of the checks, so the pair cannot
// false-green.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';

async function openAndMeasure(page: Page): Promise<{ trigger: number; menu: number }> {
  const trigger = page.getByRole('button', { name: 'Switch workspace' });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  const tBox = await trigger.boundingBox();
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const mBox = await menu.boundingBox();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  if (!tBox || !mBox) throw new Error('missing bounding box');
  return { trigger: tBox.width, menu: mBox.width };
}

test.describe('item P16 — workspace switcher dropdown width', () => {
  test('menu tracks the trigger at default, max, and floors at min width', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    // Default sidebar (240px): menu width equals the trigger width.
    const initial = await openAndMeasure(page);
    expect(
      Math.abs(initial.menu - initial.trigger),
      `default: menu ${initial.menu} vs trigger ${initial.trigger}`,
    ).toBeLessThanOrEqual(1.5);

    // Resize the sidebar to MAX (480px) through the real handle.
    const handle = page.getByRole('separator', { name: 'Resize sidebar' });
    await handle.focus();
    await page.keyboard.press('End');
    const wide = await openAndMeasure(page);
    expect(wide.trigger, 'trigger must grow with the sidebar').toBeGreaterThan(
      initial.trigger + 100,
    );
    expect(
      Math.abs(wide.menu - wide.trigger),
      `wide: menu ${wide.menu} vs trigger ${wide.trigger}`,
    ).toBeLessThanOrEqual(1.5);

    // Resize to MIN (200px): the trigger drops below 224px, the min-w-56
    // floor holds the menu at >=224px so items stay readable.
    await handle.focus();
    await page.keyboard.press('Home');
    const narrow = await openAndMeasure(page);
    expect(narrow.trigger, 'trigger must shrink below the floor').toBeLessThan(224);
    expect(narrow.menu, 'menu floors at min-w-56').toBeGreaterThanOrEqual(223);
  });
});
