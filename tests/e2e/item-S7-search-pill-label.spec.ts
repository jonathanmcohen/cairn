// v0.10.2 S7 — search pill: drop the "(command palette)" parenthetical.
//
// Behavior under guard: the sidebar search pill's visible label is the short
// "Search or jump to…" (the aria-label still says "Open command palette" —
// the v0.9.4 #97 intent that the pill reads as the palette survives via
// aria + the ⌘K kbd chip), and the pill renders SINGLE-LINE at the default
// 240px sidebar width with a truncate guard for longer translations.
//
// The single-line check measures the rendered label height against its
// line-height — a string-only assertion could false-green while a locale
// string still wraps. RED on pre-fix: the 37-char label wraps to two lines
// (label height ≈ 2 line-heights).
import { expect, signIn, test } from '../a11y/fixtures';

const PILL = 'button[aria-label="Open command palette"]';

test.describe('item S7 — search pill label', () => {
  test('short label, single line at 240px, palette still opens', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);
    const pill = page.locator(PILL);
    await expect(pill).toBeVisible({ timeout: 30_000 });

    // Visible label dropped the parenthetical; aria + kbd chip stay.
    await expect(pill).not.toContainText('(command palette)');
    await expect(pill).toContainText('Search or jump to');
    await expect(pill.locator('kbd')).toHaveText('⌘K');

    // Single line at the 240px default width: the label span's rendered
    // height must be ONE line-height, not two (wait for fonts so the
    // measurement isn't racing a fallback-font layout).
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const metrics = await page.evaluate((sel) => {
      const span = document.querySelector(`${sel} span`);
      if (!span) return null;
      const cs = getComputedStyle(span);
      return {
        height: span.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(cs.lineHeight),
      };
    }, PILL);
    if (!metrics) throw new Error('S7: pill label span not found');
    expect(
      metrics.height,
      `label renders one line (height ${metrics.height} vs line-height ${metrics.lineHeight})`,
    ).toBeLessThan(metrics.lineHeight * 1.5);

    // Clicking still opens the Cmd+K palette (the open mechanism is the
    // synthetic ⌘K event — single source of truth with the keyboard path).
    await pill.click();
    await expect(page.locator('[data-cairn-palette]')).toBeVisible({ timeout: 10_000 });
  });
});
