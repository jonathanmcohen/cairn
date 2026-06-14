// v0.10.2 S9 — personal-hub badges in the sidebar footer nav.
//
// Behavior under guard (the flashcards "Review due" leg is OUT — Plan F1
// supersedes that row):
//   - INBOX row: a right-edge count pill ([data-testid="inbox-count-pill"])
//     tracking the workspace inbox-queue size; nothing at zero. It is a
//     right-EDGE pill (ml-auto, trailing the label), explicitly NOT a corner/
//     avatar dot — asserted by geometry.
//   - MY TASKS row: a right-edge pill wired to GET /api/tasks/count — the
//     rendered pill tracks the live server count (present with that number
//     when > 0, absent at 0).
//   - FAVORITES row: the star goes gold (fill-yellow-500) once the viewer has
//     ≥1 favorite; default (no fill) at zero.
//   - Counts carry sr-only i18n text (no bare numeral for screen readers).
//
// Inbox + favorites are seeded through the real APIs and asserted RELATIVE to
// a baseline (the long-lived e2e DB accumulates rows across runs). The
// open-tasks COUNT math (and the complete-a-task-drops-the-count behavior)
// lives in tests/lib/tasks + tests/api/tasks-count, NOT here: open tasks come
// from the `mv_user_tasks` materialized view, whose statement-trigger refresh
// does not land synchronously over a REST content PATCH, so seeding a task in
// the browser is not reproducible. What IS browser-only — that the My-tasks
// row fetches the real endpoint and renders a pill matching it — is asserted
// against the live count here.
//
// RED on pre-fix: Inbox/My-tasks rows have no pill at all; the star never
// fills.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi } from './util';

async function apiCount(page: Page, url: string): Promise<number> {
  const res = await page.request.get(url);
  expect(res.ok(), `${url} responds 2xx`).toBeTruthy();
  return ((await res.json()) as { count: number }).count;
}

test.describe('item S9 — personal-hub badges', () => {
  test('inbox pill (right edge) + my-tasks pill wiring + favorites gold star', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    const baseInbox = await apiCount(page, '/api/inbox/count');

    // Seed +1 inbox capture and +1 favorite through the real APIs.
    expect(
      (
        await page.request.post('/api/inbox', { data: { title: `S9 inbox ${Date.now()}` } })
      ).status(),
    ).toBe(201);
    const favPageId = await createPageViaApi(page, `S9 fav page ${Date.now()}`);
    expect(
      (await page.request.post('/api/prefs/favorites', { data: { pageId: favPageId } })).ok(),
    ).toBeTruthy();

    const inboxCount = await apiCount(page, '/api/inbox/count');
    expect(inboxCount, 'inbox count moved by +1').toBe(baseInbox + 1);
    const tasksCount = await apiCount(page, '/api/tasks/count');

    await page.goto(`/pages/${seeded.pageId}`);

    // --- INBOX pill: visible, tracks the count, sr-only label. ---
    const inboxPill = page.locator('[data-testid="inbox-count-pill"]');
    await expect(inboxPill).toBeVisible({ timeout: 30_000 });
    await expect(inboxPill).toContainText(inboxCount > 99 ? '99+' : String(inboxCount));
    await expect(inboxPill).toContainText(/item|items/i); // sr-only twin, words not bare numeral

    // Right-EDGE pill, not a corner/avatar dot: its left edge is past the row
    // midpoint and its right edge hugs the row's right edge (ml-auto). A
    // corner dot would overlap the icon/label, not trail it.
    const geom = await page.evaluate(() => {
      const pill = document.querySelector('[data-testid="inbox-count-pill"]');
      const row = pill?.closest('a');
      if (!pill || !row) return null;
      const p = pill.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return { pillLeft: p.left, pillRight: p.right, rowLeft: r.left, rowRight: r.right };
    });
    if (!geom) throw new Error('S9: inbox pill / row geometry missing');
    expect(geom.pillRight, 'pill right edge ≤ row right edge').toBeLessThanOrEqual(
      geom.rowRight + 1,
    );
    expect(geom.pillRight, 'pill hugs the row right edge (ml-auto)').toBeGreaterThan(
      geom.rowRight - 24,
    );
    expect(
      geom.pillLeft,
      'pill sits in the right half of the row (trailing, not a corner dot)',
    ).toBeGreaterThan(geom.rowLeft + (geom.rowRight - geom.rowLeft) / 2);

    // --- MY TASKS pill: rendered state tracks the live /api/tasks/count. ---
    const tasksPill = page.locator('[data-testid="tasks-count-pill"]');
    if (tasksCount > 0) {
      await expect(tasksPill).toBeVisible();
      await expect(tasksPill).toContainText(tasksCount > 99 ? '99+' : String(tasksCount));
      await expect(tasksPill).toContainText(/task|tasks/i);
    } else {
      await expect(tasksPill).toHaveCount(0);
    }

    // --- FAVORITES gold star (≥1 favorite) ---
    const star = page.locator('[data-testid="favorites-star"]');
    await expect(star).toHaveClass(/fill-yellow-500/);

    // --- Unfavoriting resets the star when it was the only favorite. ---
    expect(
      (await page.request.post('/api/prefs/favorites', { data: { pageId: favPageId } })).ok(),
    ).toBeTruthy();
    const favCount = (
      (await (await page.request.get('/api/prefs/favorites')).json()) as { favorites: unknown[] }
    ).favorites.length;
    await page.reload();
    const star2 = page.locator('[data-testid="favorites-star"]');
    if (favCount === 0) {
      await expect(star2).not.toHaveClass(/fill-yellow-500/);
    } else {
      await expect(star2).toHaveClass(/fill-yellow-500/);
    }
  });
});
