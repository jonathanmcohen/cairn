// v0.10.2 S3 — 1px dividers between the sidebar's conceptual groups.
//
// Behavior under guard: the upper-group container in sidebar-content.tsx
// (search pill / Pinned / Saved searches) uses divide-y, which draws a 1px
// border only BETWEEN rendered children — so sections that return null when
// empty cannot stack or strand dividers — plus border-b for the upper-group
// ↔ PAGES boundary. (v0.10.2 S17 moved Favorites into the footer and retired
// Recents, so the upper group is now search pill / Pinned / Saved searches.)
//
// The assertion is a structural invariant measured from COMPUTED styles
// (a divide-y Tailwind never emits would fail; a class-name grep would
// not): first rendered child has 0px top border, every later child exactly
// 1px, the container exactly 1px bottom — under ANY group population. The
// spec checks it twice: groups maximally populated via real APIs, then
// after unpinning (sparser population, no orphan divider).
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi } from './util';

const GROUPS = '[data-testid="sidebar-upper-groups"]';

async function dividerInvariant(
  page: Page,
): Promise<{ children: number; bottoms: string[]; containerBottom: string }> {
  return page.evaluate((selector) => {
    const container = document.querySelector(selector);
    if (!container) return { children: 0, bottoms: [], containerBottom: '' };
    const kids = Array.from(container.children) as HTMLElement[];
    return {
      children: kids.length,
      bottoms: kids.map((k) => getComputedStyle(k).borderBottomWidth),
      containerBottom: getComputedStyle(container).borderBottomWidth,
    };
  }, GROUPS);
}

function expectInvariant(inv: { children: number; bottoms: string[]; containerBottom: string }) {
  expect(inv.children).toBeGreaterThan(0);
  // Tailwind v4's divide-y puts border-BOTTOM on every child except the last
  // (`& > :not(:last-child)`), so a divider above the first group or a
  // doubled divider is structurally impossible. Child 0 is excluded from the
  // measurement: the search pill carries its own decorative 1px border either
  // way. Sections (index 1..n-2) have no intrinsic borders — their 1px bottom
  // is the divide-y divider; the LAST child must have none.
  for (let i = 1; i < inv.bottoms.length - 1; i++) {
    expect(inv.bottoms[i], `exactly one 1px divider below group ${i}`).toBe('1px');
  }
  if (inv.bottoms.length > 1) {
    expect(inv.bottoms[inv.bottoms.length - 1], 'no stranded divider on the last group').toBe(
      '0px',
    );
  }
  expect(inv.containerBottom, 'upper-group ↔ PAGES boundary divider').toBe('1px');
}

test.describe('item S3 — sidebar group dividers', () => {
  test('1px dividers between all populated groups, none stranded when groups empty', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    // Populate the upper groups through the real APIs: a fresh page that is
    // pinned (admin), plus a saved search. (v0.10.2 S17 — Favorites/Recents
    // no longer live in the upper group, so they no longer seed it.)
    const title = `S3 divider fixture ${Date.now()}`;
    const pageId = await createPageViaApi(page, title);
    const pin = await page.request.post('/api/workspace/pins', { data: { pageId } });
    expect(pin.ok()).toBeTruthy();
    const saved = await page.request.post('/api/search/saved', {
      data: { name: `S3 saved ${Date.now()}`, query: 's3 fixture', filters: {} },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto('/');
    const groups = page.locator(GROUPS);
    await expect(groups).toBeVisible({ timeout: 30_000 });
    // Wait for every seeded section to actually mount before measuring —
    // SavedSearches is client-fetched and appears a beat after hydration.
    await expect(groups.locator('[data-testid="pinned-section"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(groups.locator('section[aria-label="Saved searches"]')).toBeVisible({
      timeout: 15_000,
    });
    const populated = await dividerInvariant(page);
    // Search pill + pinned + saved searches all render.
    expect(populated.children).toBeGreaterThanOrEqual(3);
    expectInvariant(populated);

    // Sparser population: unpin, reload — divide-y must not stack or strand
    // dividers around the vanished Pinned section.
    const unpin = await page.request.delete(`/api/workspace/pins/${pageId}`);
    expect(unpin.ok()).toBeTruthy();

    await page.reload();
    await expect(page.locator(GROUPS)).toBeVisible({ timeout: 30_000 });
    const sparse = await dividerInvariant(page);
    expect(sparse.children).toBeLessThan(populated.children);
    expectInvariant(sparse);

    // Structural dividers elsewhere unchanged: the footer border-t guard.
    const footerTop = await page.evaluate(() => {
      const footer = document.querySelector('[data-cairn-workspace-sidebar] nav ~ div, footer');
      return footer ? getComputedStyle(footer).borderTopWidth : null;
    });
    if (footerTop !== null) expect(footerTop).toBe('1px');
  });
});
