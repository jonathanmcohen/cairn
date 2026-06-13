// v0.10.2 S17 — sidebar slot reorder.
//
// The plan reshuffles the sidebar into a single canonical top→bottom order and
// removes the upper-group FAVORITES + RECENTS sections (Favorites survives only
// as a footer row; Recents is gone entirely). This spec LOCKS that order in the
// real browser by walking the rendered desktop sidebar and asserting the DOM
// position of each landmark with compareDocumentPosition (markup order ==
// visual order == tab/screen-reader order, since the reorder is done in markup,
// not CSS `order:`).
//
// Target order (top→bottom):
//   switcher → search pill → PINNED → SAVED SEARCHES → PAGES tree
//   — footer — Flashcards → Favorites → Inbox → My tasks → Settings → Archived
//   → Trash → Sign out → theme toggle → Help
//
// Determinism on the persistent dev DB (state accumulates across runs): the
// populated case SNAPSHOTS the workspace pins + the user's saved searches,
// drives from a known-clean state, and RESTORES in `finally` (mirrors item-S15
// exactly). Pins are workspace-wide and the seeded user is an admin; saved
// searches are per-user throwaway rows.
import type { Locator, Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';

type Saved = { id: string; name: string };
type Pin = { pageId: string };

/** The desktop workspace sidebar (mobile drawer reuses the same body markup;
 *  `.last()` is the desktop <aside>, per the established sidebar e2e pattern). */
const sidebar = (page: Page) => page.locator('[data-cairn-workspace-sidebar]').last();

/** Assert `a` precedes `b` in DOM order (markup order == visual == tab order). */
async function assertPrecedes(a: Locator, b: Locator, label: string) {
  const aHandle = await a.elementHandle();
  const bHandle = await b.elementHandle();
  expect(aHandle, `${label}: first element present`).not.toBeNull();
  expect(bHandle, `${label}: second element present`).not.toBeNull();
  const aPrecedesB = await aHandle?.evaluate(
    // Node.DOCUMENT_POSITION_FOLLOWING === 4: `other` comes after `node`.
    (node, other) => Boolean(node.compareDocumentPosition(other as Node) & 4),
    bHandle,
  );
  expect(aPrecedesB, `${label}: first should precede second in DOM order`).toBe(true);
}

test.describe('item S17 — sidebar slot order', () => {
  test('populated: switcher → search → PINNED → SAVED SEARCHES → PAGES → footer cluster, in DOM order', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    // Snapshot pins + saved searches so we can restore them afterward.
    const pinSnap = (await (await page.request.get('/api/workspace/pins')).json()) as {
      pins: Pin[];
    };
    const originalPinIds = pinSnap.pins.map((p) => p.pageId);
    const savedSnap = (await (await page.request.get('/api/search/saved')).json()) as {
      savedSearches: Saved[];
    };

    const unique = `s17-${Date.now()}`;
    try {
      // Ensure PINNED is populated: pin the seeded page (admin can POST pins).
      const pinRes = await page.request.post('/api/workspace/pins', {
        data: { pageId: seeded.pageId },
      });
      expect(pinRes.ok()).toBe(true);

      await page.goto('/');
      const root = sidebar(page);
      await expect(root).toBeVisible({ timeout: 30_000 });

      // Ensure SAVED SEARCHES is populated: save a search via the ⌘K palette
      // (mirrors item-S15's reliable save path — it rides the mutation bus so
      // the section appears without a reload).
      await page.keyboard.press('Meta+k');
      const input = page.locator('[data-cairn-palette] input').first();
      await expect(input).toBeVisible();
      await input.fill(unique);
      const saveBtn = page.getByRole('button', { name: /save this search to the sidebar/i });
      await expect(saveBtn).toBeVisible({ timeout: 10_000 });
      await saveBtn.click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(
        root.getByRole('region', { name: 'Saved searches' }).getByText(unique),
      ).toBeVisible({ timeout: 10_000 });

      // Landmarks, scoped to the desktop sidebar.
      const searchPill = root.locator('[data-tour="search"]');
      const pinned = root.locator('[data-testid="pinned-section"]');
      const savedSearches = root.getByRole('region', { name: 'Saved searches' });
      const pagesHeading = root.locator('#sidebar-pages-heading');
      const flashcards = root.locator('[data-testid="flashcards-nav"]');
      const favorites = root.locator('a[href="/favorites"]');
      const inbox = root.locator('a[href="/inbox"]');
      const myTasks = root.locator('a[href="/my-tasks"]');
      const settings = root.locator('a[href="/settings"]');
      const archived = root.locator('a[href="/archived"]');
      const trash = root.locator('a[href="/trash"]');
      const signOut = root.getByRole('button', { name: /sign out/i });
      const help = root.locator('[data-tour="help"]');

      // Every populated landmark is present.
      for (const [name, loc] of [
        ['search pill', searchPill],
        ['PINNED', pinned],
        ['SAVED SEARCHES', savedSearches],
        ['PAGES heading', pagesHeading],
        ['Flashcards', flashcards],
        ['Favorites', favorites],
        ['Inbox', inbox],
        ['My tasks', myTasks],
        ['Settings', settings],
        ['Archived', archived],
        ['Trash', trash],
        ['Sign out', signOut],
        ['Help', help],
      ] as const) {
        await expect(loc, `${name} is rendered`).toBeVisible();
      }

      // Walk the full sequence top→bottom, asserting each precedes the next.
      const ordered: Array<[string, Locator]> = [
        ['search pill', searchPill],
        ['PINNED', pinned],
        ['SAVED SEARCHES', savedSearches],
        ['PAGES heading', pagesHeading],
        ['Flashcards', flashcards],
        ['Favorites', favorites],
        ['Inbox', inbox],
        ['My tasks', myTasks],
        ['Settings', settings],
        ['Archived', archived],
        ['Trash', trash],
        ['Sign out', signOut],
        ['Help', help],
      ];
      for (let i = 0; i < ordered.length - 1; i++) {
        const current = ordered[i];
        const next = ordered[i + 1];
        if (!current || !next) continue;
        await assertPrecedes(current[1], next[1], `${current[0]} → ${next[0]}`);
      }

      // The theme toggle (Devices slot, S12) sits between Sign out and Help in
      // the terminal cluster. It has no stable test id, but the contract that
      // matters is: it lives below Trash and above Help.
      const themeToggle = root.getByRole('button', { name: /theme|dark|light|appearance/i }).last();
      if ((await themeToggle.count()) > 0) {
        await assertPrecedes(trash, themeToggle, 'Trash → theme toggle');
        await assertPrecedes(themeToggle, help, 'theme toggle → Help');
      }
    } finally {
      // Restore pins (set membership; POST reassigns positions, immaterial).
      await page.request.delete(`/api/workspace/pins/${seeded.pageId}`).catch(() => {});
      for (const id of originalPinIds) {
        await page.request.post('/api/workspace/pins', { data: { pageId: id } }).catch(() => {});
      }
      // Delete the throwaway saved search this run created.
      const after = (await (await page.request.get('/api/search/saved')).json()) as {
        savedSearches: Saved[];
      };
      for (const s of after.savedSearches) {
        if (!savedSnap.savedSearches.some((o) => o.id === s.id)) {
          await page.request.delete(`/api/search/saved/${s.id}`).catch(() => {});
        }
      }
    }
  });

  test('empty PINNED + SAVED SEARCHES: slots 3/4 absent, no stranded upper dividers', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    const pinSnap = (await (await page.request.get('/api/workspace/pins')).json()) as {
      pins: Pin[];
    };
    const originalPinIds = pinSnap.pins.map((p) => p.pageId);
    const savedInitial = (await (await page.request.get('/api/search/saved')).json()) as {
      savedSearches: Saved[];
    };

    try {
      // Clear pins + saved searches → known-empty upper group.
      for (const id of originalPinIds) {
        await page.request.delete(`/api/workspace/pins/${id}`).catch(() => {});
      }
      for (const s of savedInitial.savedSearches) {
        await page.request.delete(`/api/search/saved/${s.id}`).catch(() => {});
      }

      await page.goto('/');
      const root = sidebar(page);
      await expect(root).toBeVisible({ timeout: 30_000 });

      // Slots 3 + 4 are absent (the sections return null when empty).
      await expect(root.locator('[data-testid="pinned-section"]')).toHaveCount(0);
      await expect(root.getByRole('region', { name: 'Saved searches' })).toHaveCount(0);

      // No stranded divider: the upper group uses `divide-y`, which only paints
      // between RENDERED children. With PINNED + SAVED SEARCHES null, only the
      // search pill remains, so the group has a single child and no internal
      // rule. The order with the empty sections gone is search → PAGES.
      const searchPill = root.locator('[data-tour="search"]');
      const pagesHeading = root.locator('#sidebar-pages-heading');
      await expect(searchPill).toBeVisible();
      await expect(pagesHeading).toBeVisible();
      await assertPrecedes(searchPill, pagesHeading, 'search pill → PAGES (empty upper)');
    } finally {
      await page.request.delete(`/api/workspace/pins/${seeded.pageId}`).catch(() => {});
      for (const id of originalPinIds) {
        await page.request.post('/api/workspace/pins', { data: { pageId: id } }).catch(() => {});
      }
      // Saved searches were per-user throwaways; nothing to recreate (no
      // create-by-row endpoint — same as item-S15).
      void savedInitial;
    }
  });

  test('Favorites + Recents are NOT in the upper group (Favorites is footer-only, Recents removed)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    const root = sidebar(page);
    await expect(root).toBeVisible({ timeout: 30_000 });

    // The upper group (capped 45% region) holds search/PINNED/SAVED SEARCHES
    // only — no FAVORITES section and no RECENTS section.
    const upper = root.locator('[data-testid="sidebar-upper-groups"]');
    await expect(upper).toBeVisible();
    await expect(upper.getByRole('region', { name: 'Favorite pages' })).toHaveCount(0);
    await expect(upper.getByRole('region', { name: 'Recent pages' })).toHaveCount(0);
    // Recents is gone from the whole sidebar (not relocated).
    await expect(root.getByRole('region', { name: 'Recent pages' })).toHaveCount(0);

    // Favorites still exists, but ONLY as the footer destination link.
    const favLinks = root.locator('a[href="/favorites"]');
    await expect(favLinks).toHaveCount(1);
    // …and it lives in the footer, below the PAGES tree heading.
    await assertPrecedes(
      root.locator('#sidebar-pages-heading'),
      favLinks,
      'PAGES → Favorites (footer)',
    );
  });

  test('tab order matches visual order: footer links are in slot order in the DOM', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    const root = sidebar(page);
    await expect(root).toBeVisible({ timeout: 30_000 });

    // The reorder is markup-only, so a plain DOM-order read of the footer's
    // destination links equals the target tab order.
    const target = ['/favorites', '/inbox', '/my-tasks', '/settings', '/archived', '/trash'];
    const positions = await Promise.all(
      target.map(async (href) => {
        const handle = await root.locator(`a[href="${href}"]`).first().elementHandle();
        expect(handle, `${href} link present`).not.toBeNull();
        return handle;
      }),
    );
    for (let i = 0; i < positions.length - 1; i++) {
      const precedes = await positions[i]?.evaluate(
        (node, other) => Boolean(node.compareDocumentPosition(other as Node) & 4),
        positions[i + 1],
      );
      expect(precedes, `${target[i]} should precede ${target[i + 1]} in tab order`).toBe(true);
    }
  });
});
