// v0.10.2 P13 — encryption env-config-off notice uses info-blue, not warning
// amber or neutral gray.
//
// Behavior under guard: EncryptionDisabledNotice (src/components/admin/
// encryption-disabled-notice.tsx) is styled from the semantic `--info` token
// pair in globals.css (light + dark values, surfaced as Tailwind utilities
// through the `@theme inline` `--color-info` mapping). The e2e build runs
// with NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION unset (defaults false), so the
// notice renders on BOTH mounting pages. This spec drives each mount through
// the proxy and asserts, light AND dark:
//   - the notice paints a non-transparent background and border;
//   - both resolve to a BLUE-dominant color (the pre-fix gray bg-muted/40 and
//     any amber restyle fail this — blue channel must dominate red and green);
//   - toggling `.dark` on <html> swaps to the dark-mode pair (bg changes);
//   - no warning/amber utility classes remain on the notice.
import type { Locator } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';

type Rgba = { r: number; g: number; b: number; a: number };

/**
 * Resolve the notice's computed background/border to rgba bytes via a 1×1
 * canvas. getComputedStyle serializes Tailwind v4's color-mix() results in
 * color-space-dependent formats (oklab/color(srgb …)); canvas fillStyle
 * parses any of them and getImageData hands back plain bytes. Alpha
 * un-premultiply quantizes channels (±~13 at alpha 0.1) — assertions below
 * keep >40-point margins.
 */
async function noticeColors(
  notice: Locator,
): Promise<{ bg: Rgba; border: Rgba; className: string }> {
  return notice.evaluate((el) => {
    const toRgba = (value: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: d[3] ?? 0 };
    };
    const cs = getComputedStyle(el);
    return {
      bg: toRgba(cs.backgroundColor),
      border: toRgba(cs.borderTopColor),
      className: el.getAttribute('class') ?? '',
    };
  });
}

function expectBlueDominant(c: Rgba, label: string) {
  expect(c.a, `${label} must be non-transparent`).toBeGreaterThan(0);
  expect(c.b, `${label} blue channel must dominate red (got ${JSON.stringify(c)})`).toBeGreaterThan(
    c.r + 40,
  );
  expect(
    c.b,
    `${label} blue channel must dominate green (got ${JSON.stringify(c)})`,
  ).toBeGreaterThan(c.g + 30);
}

const MOUNTS = [
  { name: 'admin encryption page', path: '/settings/admin/encryption' },
  { name: 'security encryption page', path: '/settings/security/encryption' },
] as const;

test.describe('item P13 — encryption disabled notice info-blue tone', () => {
  for (const mount of MOUNTS) {
    test(`${mount.name} renders the notice in info-blue, light and dark`, async ({
      page,
      seeded,
    }) => {
      await signIn(page, seeded);
      await page.goto(mount.path);

      const notice = page.getByTestId('encryption-disabled-notice');
      await expect(notice).toBeVisible({ timeout: 30_000 });

      // No leftover warning/amber utilities on the restyled notice.
      const light = await noticeColors(notice);
      expect(light.className).not.toMatch(/warning|amber/);

      expectBlueDominant(light.bg, `${mount.name} light background`);
      expectBlueDominant(light.border, `${mount.name} light border`);

      // Decorative info icon is hidden from the a11y tree.
      await expect(notice.locator('svg[aria-hidden="true"]')).toHaveCount(1);

      // Dark mode: same token chain, dark pair — still blue, different paint.
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      const dark = await noticeColors(notice);
      expectBlueDominant(dark.bg, `${mount.name} dark background`);
      expectBlueDominant(dark.border, `${mount.name} dark border`);
      const delta =
        Math.abs(dark.bg.r - light.bg.r) +
        Math.abs(dark.bg.g - light.bg.g) +
        Math.abs(dark.bg.b - light.bg.b);
      expect(delta, 'dark-mode background must differ from light').toBeGreaterThan(30);
    });
  }
});
