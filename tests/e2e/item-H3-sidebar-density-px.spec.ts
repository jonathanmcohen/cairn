// v0.10.0 H3 — C1 sidebar-density runtime-px guard.
//
// The v0.9.19 C1 density guard was source-assertion only (it grepped the
// CSS/class names), so a change that broke the RENDERED row height could pass
// it. This spec measures real pixels in the live sidebar and asserts the
// contract against the exported ROW_HEIGHT_PX constant — a deliberate token
// change updates the contract and this spec in one place.

// The contract, not a hardcoded copy of it (#208: 26px rows). v0.10.2 S2
// made density a per-device preference — this guard pins the COMFORTABLE
// (default) contract, clearing any persisted density first so a compact
// preference left behind by another spec can't skew the measurement.
import {
  ROW_HEIGHT_PX,
  SIDEBAR_DENSITY_STORAGE_KEY,
} from '../../src/components/sidebar/density-tokens';
import { expect, signIn, test } from '../a11y/fixtures';

const PAGE_ROW = '[data-cairn-workspace-sidebar] [data-virtual-row][data-row-kind="page"]';

/**
 * Measure the first page row's rendered height, AFTER layout settles: wait
 * for web fonts, then poll until two consecutive reads agree on a nonzero
 * value (no CLS race). The query and the measurement happen atomically in
 * ONE page.evaluate — the virtualized tree re-keys rows continuously, so a
 * locator handle can detach between resolution and evaluation and report a
 * zero rect.
 */
async function measureSettledRowHeight(page: import('@playwright/test').Page): Promise<number> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  let previous = -1;
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(
          (selector) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0,
          PAGE_ROW,
        );
        const stable = current > 0 && current === previous;
        previous = current;
        return stable;
      },
      { timeout: 10_000, message: 'sidebar row height never stabilized' },
    )
    .toBe(true);
  return previous;
}

test.describe('item H3 — sidebar density runtime-px guard', () => {
  test('(a) a rendered page-tree row measures exactly ROW_HEIGHT_PX', async ({ page, seeded }) => {
    await signIn(page, seeded);
    // S2 guard: pin the COMFORTABLE default — clear any density another spec
    // persisted in this worker before the page scripts rehydrate it.
    await page.addInitScript((key) => localStorage.removeItem(key), SIDEBAR_DENSITY_STORAGE_KEY);
    await page.goto(`/pages/${seeded.pageId}`);
    await expect(page.locator(PAGE_ROW).first()).toBeVisible({ timeout: 30_000 });

    const height = await measureSettledRowHeight(page);
    expect(
      Math.round(height),
      `rendered sidebar row height drifted from the ROW_HEIGHT_PX=${ROW_HEIGHT_PX} contract`,
    ).toBe(ROW_HEIGHT_PX);
  });

  test('(b) falsifiable: a CSS perturbation that breaks row height is DETECTED', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // S2 guard: pin the COMFORTABLE default — clear any density another spec
    // persisted in this worker before the page scripts rehydrate it.
    await page.addInitScript((key) => localStorage.removeItem(key), SIDEBAR_DENSITY_STORAGE_KEY);
    await page.goto(`/pages/${seeded.pageId}`);
    await expect(page.locator(PAGE_ROW).first()).toBeVisible({ timeout: 30_000 });

    // Sanity: the unperturbed row honors the contract first.
    expect(Math.round(await measureSettledRowHeight(page))).toBe(ROW_HEIGHT_PX);

    // Perturb the rendered height the way a careless CSS change would —
    // !important because the virtualizer sets the row height inline. The
    // old source-grep guard passed this scenario; the pixel measurement
    // must not.
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'h3-density-perturbation';
      style.textContent = '[data-virtual-row][data-row-kind="page"]{height:40px !important;}';
      document.head.appendChild(style);
    });

    // Atomic query+measure (see measureSettledRowHeight) — and poll, since
    // the style application needs a layout pass.
    await expect
      .poll(
        () =>
          page.evaluate(
            (selector) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0,
            PAGE_ROW,
          ),
        {
          timeout: 10_000,
          message: 'the runtime measurement failed to detect a broken rendered row height',
        },
      )
      .toBe(40);
  });
});
