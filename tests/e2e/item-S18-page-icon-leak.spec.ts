// v0.10.2 S18 — page-icon shortcode leak.
//
// Behavior under guard: a page whose stored icon is prefix-encoded
// ("emoji::🚀") must render the bare glyph (🚀) everywhere a page icon is
// shown — the "emoji::"/"file::" scheme prefix must NEVER reach the DOM as
// literal text. This is the documented Trash-list regression class; v0.10.2
// found it live in the sidebar PINNED section (plus the footer Favorites
// group and the /favorites route), all of which rendered `{page.icon}` raw
// instead of routing through the shared <InlineIcon> parser.
//
// The spec drives the real browser through the proxy: it sets a prefix-encoded
// icon via the page PATCH API (the same payload the icon picker sends — which
// also exercises the widened max(64) validator, since "emoji::🚀" is 9 chars),
// pins + favorites the page, then asserts the rendered rows contain the glyph
// and never the literal "emoji::". RED on the pre-fix build: the raw renders
// print "emoji::🚀".
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi } from './util';

const PREFIXED_ICON = 'emoji::🚀';
const GLYPH = '🚀';

const createdPageIds: string[] = [];

async function mkPage(page: Page, title: string): Promise<string> {
  const id = await createPageViaApi(page, title);
  createdPageIds.push(id);
  return id;
}

test.afterEach(async ({ page }) => {
  for (const id of createdPageIds.splice(0)) {
    await page.request.delete(`/api/pages/${id}`).catch(() => {});
  }
});

test.describe('item S18 — page-icon shortcode leak', () => {
  test('prefix-encoded icon renders the glyph, never the literal "emoji::"', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    const title = `S18 icon fixture ${Date.now()}`;
    const pageId = await mkPage(page, title);

    // Set a prefix-encoded icon via the same PATCH the picker uses. "emoji::🚀"
    // is 9 UTF-16 units — this fails on the pre-widening max(8) validator, so a
    // green here also proves the validator fix.
    const patch = await page.request.patch(`/api/pages/${pageId}`, {
      data: { icon: PREFIXED_ICON },
    });
    expect(patch.ok(), 'PATCH icon accepted (max(64) validator)').toBe(true);

    // Pin (workspace PINNED section) + favorite (footer group + /favorites).
    expect((await page.request.post('/api/workspace/pins', { data: { pageId } })).ok()).toBe(true);
    expect((await page.request.post('/api/prefs/favorites', { data: { pageId } })).ok()).toBe(true);

    // --- PINNED section (sidebar-content upper group) ---
    await page.goto('/');
    const pinned = page.locator('[data-testid="pinned-section"]');
    await expect(pinned).toBeVisible({ timeout: 30_000 });
    const pinnedRow = pinned.locator('li', { hasText: title });
    await expect(pinnedRow).toBeVisible({ timeout: 15_000 });
    expect(
      await pinnedRow.textContent(),
      'pinned row must not leak the scheme prefix',
    ).not.toContain('emoji::');
    await expect(pinnedRow).toContainText(GLYPH);

    // --- /favorites route (favorites-list.tsx) ---
    await page.goto('/favorites');
    const favRow = page.locator('li', { hasText: title }).first();
    await expect(favRow).toBeVisible({ timeout: 30_000 });
    expect(await favRow.textContent(), '/favorites row must not leak the prefix').not.toContain(
      'emoji::',
    );
    await expect(favRow).toContainText(GLYPH);

    // Cleanup the pin/favorite so later specs see the seeded baseline (the page
    // itself is deleted in afterEach).
    expect((await page.request.delete(`/api/workspace/pins/${pageId}`)).ok()).toBe(true);
    await page.request.post('/api/prefs/favorites', { data: { pageId } }).catch(() => {});
  });
});
