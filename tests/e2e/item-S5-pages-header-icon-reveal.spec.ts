// v0.10.2 S5 — PAGES header action icons: 30% at rest, 100% on section hover.
//
// Behavior under guard: the collapse/expand-all toggle and the New-page
// button in the PAGES section header sit at opacity 0.3 until the pointer
// enters the PAGES section (`group/pages` on the <section>) or the button
// itself receives keyboard focus (`focus-visible:opacity-100` — a hover-only
// reveal that strands keyboard users fails here). The buttons stay mounted
// and clickable while dimmed. NewPageButton at its OTHER call site (the
// workspace landing main area) is NOT dimmed — the classes are injected by
// pages-section, not baked into the component.
//
// Hover-gated UI cannot be verified by static DOM greps (the B2/#117 lesson
// in docs/operations.md): this spec moves the real pointer and reads computed
// opacity. RED on pre-fix: opacity is 1 at rest.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';

const HEADER = '[data-pages-header]';
const TOGGLE = `${HEADER} button[aria-pressed]`;
const NEW_PAGE = `${HEADER} button[aria-label="New page"]`;

function opacityOf(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? Number.parseFloat(getComputedStyle(el).opacity) : Number.NaN;
  }, selector);
}

/** Poll until the selector's computed opacity settles at `target` —
 * transition-opacity means a single read races the animation. */
async function expectOpacity(page: Page, selector: string, target: number, label: string) {
  await expect
    .poll(() => opacityOf(page, selector), { timeout: 5_000, message: label })
    .toBeCloseTo(target, 2);
}

test.describe('item S5 — PAGES header icon reveal', () => {
  test('icons rest at 0.3, reveal on section hover and on keyboard focus', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);
    await expect(page.locator(HEADER)).toBeVisible({ timeout: 30_000 });

    // Park the pointer in the editor area — far from the sidebar.
    await page.mouse.move(900, 400);
    await expectOpacity(page, TOGGLE, 0.3, 'collapse-all toggle dimmed at rest');
    await expectOpacity(page, NEW_PAGE, 0.3, 'New-page button dimmed at rest');

    // Dimmed ≠ disabled: both stay mounted, enabled and hit-testable.
    await expect(page.locator(TOGGLE)).toBeEnabled();
    await expect(page.locator(NEW_PAGE)).toBeEnabled();
    const interactive = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
    }, NEW_PAGE);
    expect(interactive, 'New-page button stays clickable while dimmed').toBe(true);

    // Hovering anywhere in the PAGES section reveals both icons.
    await page.locator('#sidebar-pages-heading').hover();
    await expectOpacity(page, TOGGLE, 1, 'toggle revealed on section hover');
    await expectOpacity(page, NEW_PAGE, 1, 'New-page revealed on section hover');

    // Leaving the section dims them again.
    await page.mouse.move(900, 400);
    await expectOpacity(page, TOGGLE, 0.3, 'toggle re-dimmed after hover leaves');
    await expectOpacity(page, NEW_PAGE, 0.3, 'New-page re-dimmed after hover leaves');

    // Keyboard path: a full Tab-walk is impractical (the tree and editor own
    // dozens of stops), so set keyboard modality with a real Tab press, then
    // move focus programmatically — Chromium applies :focus-visible to
    // script focus when the preceding input was keyboard, which is exactly
    // the state a keyboard user is in.
    for (const [selector, label] of [
      [TOGGLE, 'collapse-all toggle'],
      [NEW_PAGE, 'New-page button'],
    ] as const) {
      await page.keyboard.press('Tab');
      await page.locator(selector).focus();
      const focused = await page.evaluate(
        (sel) => document.activeElement === document.querySelector(sel),
        selector,
      );
      expect(focused, `${label} holds keyboard focus`).toBe(true);
      await expectOpacity(page, selector, 1, `${label} revealed on keyboard focus`);
    }
  });

  // NewPageButton's other call site (the empty-workspace landing) is
  // unreachable in the seeded e2e env; the not-dimmed-by-default invariant is
  // covered by tests/components/new-page-button-dimming.test.tsx instead.
});
