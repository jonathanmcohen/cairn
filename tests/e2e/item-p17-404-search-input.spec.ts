// v0.10.2 P17 — 404 page carries a recovery search input.
//
// Behavior under guard: src/app/not-found.tsx renders a plain GET form
// (input name="q" → /search) below the Back-to-home button. A signed-in
// visitor who hits a dead URL can search without retreating to home; the
// form posts nothing client-side, so it cannot leak anonymous visitors into
// the session-gated /api/search route. This spec requests a nonexistent
// route through the proxy (a REAL 404 render, not a component mount),
// asserts the input sits below the button, and submits a query — asserting
// actual navigation to /search with the query applied, which a markup-only
// check would false-green.
import { expect, signIn, test } from '../a11y/fixtures';

test.describe('item P17 — 404 page search input', () => {
  test('404 page renders the search form below Back-to-home and submits to /search', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto(`/this-route-does-not-exist-p17-${Date.now()}`);

    await expect(page.getByRole('heading', { name: 'This page wandered off' })).toBeVisible({
      timeout: 30_000,
    });

    const home = page.getByRole('link', { name: 'Back to home' });
    const input = page.getByRole('searchbox', { name: 'Search pages' });
    await expect(home).toBeVisible();
    await expect(input).toBeVisible();

    // Layout contract: the search form sits BELOW the Back-to-home button.
    const homeBox = await home.boundingBox();
    const inputBox = await input.boundingBox();
    if (!homeBox || !inputBox) throw new Error('missing bounding box');
    expect(inputBox.y).toBeGreaterThan(homeBox.y + homeBox.height - 1);

    // Submit a query: the GET form must navigate to the in-app search
    // destination with q applied (signed-in path).
    await input.fill('p17 recovery query');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=p17\+recovery\+query/, { timeout: 30_000 });
    // The search page consumed the query: SearchChipInput's free-text input
    // (aria-label "Search") is seeded from ?q=.
    await expect(page.getByRole('textbox', { name: 'Search', exact: true })).toHaveValue(
      'p17 recovery query',
      { timeout: 15_000 },
    );
  });
});
