// v0.10.2 S4 — sidebar section headers: 10px tracked uppercase at 60% opacity.
//
// Behavior under guard: all five sidebar section headers (Pinned, Favorites,
// Recents, Saved searches, PAGES) share the `--cairn-sidebar-heading` token
// (10px) and `text-muted-foreground/60` (alpha 0.6) — previously a drifting
// 11px/12px mix at full opacity, with Pinned a lone font-semibold outlier
// (GO decision: unified to regular weight).
//
// The assertions read COMPUTED styles per header — a class-name grep would
// pass with a token Tailwind never emits, and a single-header check would
// miss the 11px/12px stragglers. RED on pre-fix: headers measure 11px/12px
// with alpha 1 (and Pinned at weight 600).
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi } from './util';

type HeaderStyle = {
  fontSize: string;
  alpha: number;
  textTransform: string;
  letterSpacing: string;
  fontWeight: string;
};

/** Parse the alpha channel out of a computed color (rgba(), rgb(), or
 * modern color(... / a) syntax). No alpha present → fully opaque. */
function parseAlpha(color: string): number {
  const slash = color.match(/\/\s*([\d.]+)\s*\)/)?.[1];
  if (slash !== undefined) return Number.parseFloat(slash);
  const rgba = color.match(/rgba\([^)]+,\s*([\d.]+)\s*\)/)?.[1];
  if (rgba !== undefined) return Number.parseFloat(rgba);
  return 1;
}

async function headerStyle(page: Page, selector: string): Promise<HeaderStyle> {
  const raw = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      color: cs.color,
      textTransform: cs.textTransform,
      letterSpacing: cs.letterSpacing,
      fontWeight: cs.fontWeight,
    };
  }, selector);
  if (!raw) throw new Error(`S4: header not found for selector ${selector}`);
  return {
    fontSize: raw.fontSize,
    alpha: parseAlpha(raw.color),
    textTransform: raw.textTransform,
    letterSpacing: raw.letterSpacing,
    fontWeight: raw.fontWeight,
  };
}

function expectHeaderContract(label: string, style: HeaderStyle) {
  expect(style.fontSize, `${label}: 10px via --cairn-sidebar-heading`).toBe('10px');
  expect(style.alpha, `${label}: 60% opacity (muted-foreground/60)`).toBeCloseTo(0.6, 2);
  // No regression of the already-shipped treatment.
  expect(style.textTransform, `${label}: stays uppercase`).toBe('uppercase');
  expect(style.letterSpacing, `${label}: stays tracked`).not.toBe('normal');
  // GO decision: Pinned's outlier font-semibold is dropped — all five regular.
  expect(style.fontWeight, `${label}: regular weight (no semibold outlier)`).toBe('400');
}

test.describe('item S4 — sidebar section headers', () => {
  test('all five headers measure 10px uppercase tracked at 60% opacity', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    // Populate every optional section through the real APIs so all five
    // headers render: pin + favorite a fresh page, save a search. (Recents
    // is tolerated absent locally — the long-lived dev DB is missing
    // migration 0020's user_page_prefs_user_page_unique index, which 500s
    // the upsert; CI's fresh Postgres always runs that leg.)
    const pageId = await createPageViaApi(page, `S4 header fixture ${Date.now()}`);
    expect((await page.request.post('/api/prefs/favorites', { data: { pageId } })).ok()).toBe(true);
    expect((await page.request.post('/api/workspace/pins', { data: { pageId } })).ok()).toBe(true);
    expect(
      (
        await page.request.post('/api/search/saved', {
          data: { name: `S4 saved ${Date.now()}`, query: 's4 fixture', filters: {} },
        })
      ).ok(),
    ).toBe(true);
    const recentsSeeded = (
      await page.request.post('/api/prefs/recents', { data: { pageId } })
    ).ok();

    await page.goto('/');
    await expect(page.locator('[data-testid="pinned-section"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('section[aria-label="Favorite pages"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('section[aria-label="Saved searches"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('#sidebar-pages-heading')).toBeVisible({ timeout: 15_000 });

    expectHeaderContract('Pinned', await headerStyle(page, '[data-testid="pinned-section"] > div'));
    expectHeaderContract(
      'Favorites',
      await headerStyle(page, 'section[aria-label="Favorite pages"] p'),
    );
    if (recentsSeeded) {
      await expect(page.locator('section[aria-label="Recent pages"]')).toBeVisible({
        timeout: 15_000,
      });
      expectHeaderContract(
        'Recents',
        await headerStyle(page, 'section[aria-label="Recent pages"] p'),
      );
    }
    expectHeaderContract(
      'Saved searches',
      await headerStyle(page, 'section[aria-label="Saved searches"] p'),
    );
    expectHeaderContract('PAGES', await headerStyle(page, '#sidebar-pages-heading'));

    // Cleanup so later specs see the seeded baseline.
    expect((await page.request.delete(`/api/workspace/pins/${pageId}`)).ok()).toBe(true);
    expect((await page.request.post('/api/prefs/favorites', { data: { pageId } })).ok()).toBe(true);
  });
});
