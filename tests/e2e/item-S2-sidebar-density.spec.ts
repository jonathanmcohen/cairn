// v0.10.2 S2 — sidebar density preference (comfortable vs compact).
//
// Behavior under guard: Settings → Account → Theme gains a "Sidebar density"
// fieldset (testids density-comfortable / density-compact). Selecting compact
// persists 'compact' to localStorage cairn:sidebar-density (per-device, no
// server round-trip), toggles root class cairn-sidebar-compact (font tokens
// 13px/18px → 12px/16px), and the virtualizer re-measures rows 26px → 22px.
//
// The H3 lesson applies: px guards must measure RENDERED rows, not token
// constants — a setting that writes state but never reaches estimateSize or
// the CSS tokens fails the pixel assertions here.
import type { Page } from '@playwright/test';
import {
  ROW_HEIGHT_BY_DENSITY,
  SIDEBAR_DENSITY_STORAGE_KEY,
} from '../../src/components/sidebar/density-tokens';
import { expect, signIn, test } from '../a11y/fixtures';

const PAGE_ROW = '[data-cairn-workspace-sidebar] [data-virtual-row][data-row-kind="page"]';

/** Atomic query+measure (rows re-key continuously; see item-H3 spec). */
async function rowMetrics(page: Page): Promise<{ height: number; fontSize: string }> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return { height: 0, fontSize: '' };
    // The --cairn-sidebar-text token lands on the row's link/text node, not
    // the virtualized container (which inherits the 16px body size).
    const text = el.querySelector('a, button, span') ?? el;
    return {
      height: el.getBoundingClientRect().height,
      fontSize: getComputedStyle(text).fontSize,
    };
  }, PAGE_ROW);
}

async function expectDensity(page: Page, rowPx: number, font: string) {
  await expect
    .poll(async () => (await rowMetrics(page)).height, {
      timeout: 15_000,
      message: `row height never reached ${rowPx}px`,
    })
    .toBeCloseTo(rowPx, 0);
  expect((await rowMetrics(page)).fontSize).toBe(font);
}

test.describe('item S2 — sidebar density preference', () => {
  test('compact toggles 22px rows / 12px font, survives reload, comfortable restores 26/13', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // Deterministic start: comfortable. One-time clear (NOT addInitScript —
    // that would re-clear on every navigation and break the reload-persistence
    // assertion below).
    await page.goto('/');
    await page.evaluate((key) => localStorage.removeItem(key), SIDEBAR_DENSITY_STORAGE_KEY);

    await page.goto(`/pages/${seeded.pageId}`);
    await expect(page.locator(PAGE_ROW).first()).toBeVisible({ timeout: 30_000 });
    await expectDensity(page, ROW_HEIGHT_BY_DENSITY.comfortable, '13px');

    // Toggle through the REAL settings surface.
    await page.goto('/settings/account/theme');
    await page.getByTestId('density-compact').click();

    // Back on a tree route: rendered rows shrink to the compact contract and
    // the virtualizer spacing matches (consecutive row offsets differ by
    // exactly the compact height — no overlap/gap after re-measure).
    await page.goto(`/pages/${seeded.pageId}`);
    await expect(page.locator(PAGE_ROW).first()).toBeVisible({ timeout: 30_000 });
    await expectDensity(page, ROW_HEIGHT_BY_DENSITY.compact, '12px');
    const gap = await page.evaluate((selector) => {
      const rows = Array.from(document.querySelectorAll(selector));
      if (rows.length < 2) return null;
      const a = rows[0]?.getBoundingClientRect();
      const b = rows[1]?.getBoundingClientRect();
      return a && b ? Math.round(b.top - a.top) : null;
    }, PAGE_ROW);
    if (gap !== null) expect(gap).toBe(ROW_HEIGHT_BY_DENSITY.compact);

    // Per-device persistence: reload, still compact.
    await page.reload();
    await expect(page.locator(PAGE_ROW).first()).toBeVisible({ timeout: 30_000 });
    await expectDensity(page, ROW_HEIGHT_BY_DENSITY.compact, '12px');

    // Comfortable restores the corrected baseline exactly: 26px rows / 13px.
    await page.goto('/settings/account/theme');
    await page.getByTestId('density-comfortable').click();
    await page.goto(`/pages/${seeded.pageId}`);
    await expect(page.locator(PAGE_ROW).first()).toBeVisible({ timeout: 30_000 });
    await expectDensity(page, ROW_HEIGHT_BY_DENSITY.comfortable, '13px');
  });
});
