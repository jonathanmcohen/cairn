// v0.9.19 C2 (#143) — runtime regression lock for cross-workspace data
// isolation on workspace switch. The v0.9.18 fix (PR #324) had two halves:
//   1. the workspace switcher does a HARD navigation (window.location.assign)
//      so no in-memory React/sidebar cache survives the switch, and
//   2. the service worker uses network-first for cookie-scoped /api GET reads
//      so a URL-keyed cache can't serve workspace A's response in workspace B.
// Half (2) is unit-covered (tests/pwa/sw-strategy.test.ts). This spec exercises
// the live mechanism end-to-end: a saved search created in workspace A must NOT
// appear in the sidebar after switching to workspace B. Guard (the fix already
// shipped) — no "before"; falsifiability proven by reverting the switcher to a
// soft navigation, which makes this spec fail (recorded in the PR).
import { expect, signIn, test } from '../a11y/fixtures';

test.describe('item #143 — workspace switch clears cross-workspace sidebar data', () => {
  test('a saved search from workspace A does not leak into workspace B', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const alpha = `ALPHA-only-${stamp}`;
    const bravo = `BRAVO-only-${stamp}`;
    // Scope to the Saved searches sidebar section — the saved-search name can
    // also surface in other links (e.g. the ⌘K recents), which would make a
    // bare getByRole('link', { name }) ambiguous.
    const savedSearches = page.locator('section[aria-label="Saved searches"]');
    const savedLink = (name: string) => savedSearches.getByRole('link', { name });

    // 1. Create a saved search in the seeded workspace A — the data that must
    //    NOT leak into another workspace.
    const aRes = await page.request.post('/api/search/saved', {
      data: { name: alpha, query: alpha, filters: {} },
    });
    expect(aRes.ok(), 'create saved search in A').toBe(true);

    // 2. Create workspace B. POST /api/workspaces flips the active cookie to the
    //    new workspace, so switch the cookie back to A before loading the page —
    //    that way the switcher's server-rendered list contains BOTH workspaces
    //    and the user starts in A (where ALPHA lives).
    const wsRes = await page.request.post('/api/workspaces', {
      data: { name: `WS-B-${stamp}`, icon: null },
    });
    expect(wsRes.ok(), 'create workspace B').toBe(true);
    const switchBack = await page.request.post('/api/workspaces/switch', {
      data: { workspaceId: seeded.workspaceId },
    });
    expect(switchBack.ok(), 'switch active back to A').toBe(true);

    // 3. Load the app in workspace A; ALPHA is in the sidebar.
    await page.goto('/');
    await expect(savedLink(alpha)).toBeVisible({ timeout: 30_000 });

    // 4. Switch to workspace B through the real switcher: clicking the item
    //    POSTs the switch and then window.location-assigns '/', the HARD nav
    //    that clears A's in-memory sidebar (#143). Both workspaces are empty so
    //    both land on '/' — the URL does NOT change, so we wait for the document
    //    'load' event instead, which is the direct signature of the hard reload.
    //    A soft client nav (router.push) never reloads the document and so never
    //    fires 'load' — this wait would then time out, which is the #143 bug.
    await page.getByRole('button', { name: 'Switch workspace' }).click();
    const bItem = page.getByRole('menuitem', { name: new RegExp(`WS-B-${stamp}`) });
    await expect(bItem).toBeVisible({ timeout: 10_000 });
    // The workspace list scrolls inside the popover; bring B's item into the
    // scroll viewport before clicking so this stays reliable when the account
    // has accumulated many workspaces (the dropdown is taller than the screen).
    await bItem.scrollIntoViewIfNeeded();
    await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), bItem.click()]);

    // 5. FALSIFIABLE CORE — assert ALPHA is gone with NO intervening page.goto.
    //    This is the only window where hard-vs-soft navigation differ. The hard
    //    nav (window.location.assign) tears down the document and remounts
    //    SavedSearches, which refetches /api/search/saved under B's cookie, so
    //    ALPHA disappears (B has none yet). A soft client nav (router.push) never
    //    unmounts the component — it keeps A's cached items, so ALPHA stays
    //    visible (count 1) the whole time and this assertion times out red. That
    //    is exactly the #143 regression. A later page.goto('/') is itself a hard
    //    load and would mask the soft-nav bug, so the check MUST be here.
    //    (Falsifiability proven by reverting the switcher to router.push → red.)
    await expect(savedLink(alpha)).toHaveCount(0, { timeout: 20_000 });

    // 6. Create a saved search in B (the active-workspace cookie is now B).
    const bRes = await page.request.post('/api/search/saved', {
      data: { name: bravo, query: bravo, filters: {} },
    });
    expect(bRes.ok(), 'create saved search in B').toBe(true);
    await page.goto('/');

    // 7. The sidebar shows ONLY B's saved search — A's never leaks across the
    //    workspace boundary (the #143 regression).
    await expect(savedLink(bravo)).toBeVisible({ timeout: 30_000 });
    await expect(savedLink(alpha)).toHaveCount(0);
  });
});
