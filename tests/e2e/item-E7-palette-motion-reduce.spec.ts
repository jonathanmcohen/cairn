// v0.10.0 E7 — search-palette reduced-motion guard.
//
// The open fade (`animate-in fade-in-0 zoom-in-95 duration-150`) shipped in
// v0.9.14; the ledger row claiming it was missing was stale (review
// correction 2026-06-10). The only real gap was the missing
// `prefers-reduced-motion` guard — the panel animated regardless of the OS
// preference. E7 adds `motion-reduce:animate-none` and this spec pins all
// three contracts: guard honored, default motion unregressed, and the
// animation never delaying the first keystroke.
import { expect, signIn, test } from '../a11y/fixtures';

const PANEL = '[data-cairn-palette]';

async function openPalette(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });
}

async function panelAnimationName(page: import('@playwright/test').Page): Promise<string> {
  return page.locator(PANEL).evaluate((el) => getComputedStyle(el).animationName);
}

test.describe('item E7 — search palette honors prefers-reduced-motion', () => {
  test('falsifiable core: reduced-motion emulation disables the open animation', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await openPalette(page);
    // RED on the old build: the tw-animate-css `enter` keyframes still apply
    // under reduced motion (computed animation-name !== 'none').
    expect(await panelAnimationName(page)).toBe('none');
    await page.keyboard.press('Escape');
    await expect(page.locator(PANEL)).toHaveCount(0);
  });

  test('default motion: the v0.9.14 fade still plays (no regression)', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await openPalette(page);
    // The animate-in utility resolves to a real keyframe name under default
    // motion — asserting non-'none' pins the shipped fade against regression.
    expect(await panelAnimationName(page)).not.toBe('none');
    await page.keyboard.press('Escape');
    await expect(page.locator(PANEL)).toHaveCount(0);
  });

  test('the animation never delays the first keystroke: open + type filters immediately', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');
    // Open and type in the same beat — no waiting for the 150ms fade. The
    // input must receive focus immediately (focus trap not gated on the
    // animation) and the query must land in the search box.
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('settings');
    const input = page.locator(`${PANEL} input`).first();
    await expect(input).toHaveValue('settings');
    await page.keyboard.press('Escape');
    await expect(page.locator(PANEL)).toHaveCount(0);
  });
});
