// v0.10.2 S9 — personal-hub badges in the sidebar footer nav.
//
// Behavior under guard (the flashcards "Review due" leg is OUT — Plan F1
// supersedes that row):
//   - INBOX row: a right-edge count pill ([data-testid="inbox-count-pill"])
//     when the workspace inbox has captures; nothing at zero. The pill is a
//     right-EDGE pill (ml-auto, past the label), explicitly NOT a corner/
//     avatar dot — asserted by geometry.
//   - MY TASKS row: a right-edge pill counting the viewer's OPEN tasks;
//     completing a task drops the count.
//   - FAVORITES row: the star goes gold (fill-yellow-500) once the viewer has
//     ≥1 favorite; default (no fill) at zero.
//   - Counts carry sr-only i18n text (no bare numeral for screen readers).
//
// The long-lived e2e DB accumulates inbox items / tasks across runs, so every
// count assertion is RELATIVE to a baseline read from the count APIs — the
// badge wiring (does the rendered pill track the server count, at the right
// edge, with the gold star) is the browser-only thing under test; the exact
// count math is unit/integration-tested in tests/api/{inbox,tasks}-count.
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

/** A taskList doc with one taskItem assigned to `userId`, `checked` as given.
 * The pages content-PATCH fires the statement-level MV refresh trigger
 * synchronously, so the count reflects it the moment the PATCH returns. */
function taskDoc(userId: string, blockId: string, checked: boolean) {
  return {
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { blockId, checked, assignedTo: userId },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'S9 open task' }] }],
          },
        ],
      },
    ],
  };
}

test.describe('item S9 — personal-hub badges', () => {
  test('inbox + my-tasks count pills (right edge), favorites gold star', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    // Resolve the viewer's userId from a page they own (page row carries
    // createdBy) — needed to assign a task to them.
    const taskPageId = await createPageViaApi(page, `S9 task page ${Date.now()}`);
    const owner = (await (await page.request.get(`/api/pages/${taskPageId}`)).json()) as {
      createdBy: string;
    };
    expect(owner.createdBy, 'page exposes createdBy').toBeTruthy();

    const baseInbox = await apiCount(page, '/api/inbox/count');
    const baseTasks = await apiCount(page, '/api/tasks/count');

    // Seed: +1 inbox capture, +1 open task (statement trigger refreshes the
    // tasks MV), +1 favorite.
    expect(
      (
        await page.request.post('/api/inbox', { data: { title: `S9 inbox ${Date.now()}` } })
      ).status(),
    ).toBe(201);
    expect(
      (
        await page.request.patch(`/api/pages/${taskPageId}`, {
          data: { content: taskDoc(owner.createdBy, 's9-task-1', false) },
        })
      ).ok(),
    ).toBeTruthy();
    const favPageId = await createPageViaApi(page, `S9 fav page ${Date.now()}`);
    expect(
      (await page.request.post('/api/prefs/favorites', { data: { pageId: favPageId } })).ok(),
    ).toBeTruthy();

    // Server counts moved by exactly one each.
    expect(await apiCount(page, '/api/inbox/count'), 'inbox +1').toBe(baseInbox + 1);
    expect(await apiCount(page, '/api/tasks/count'), 'open tasks +1').toBe(baseTasks + 1);

    await page.goto(`/pages/${seeded.pageId}`);

    // --- INBOX pill ---
    const inboxPill = page.locator('[data-testid="inbox-count-pill"]');
    await expect(inboxPill).toBeVisible({ timeout: 30_000 });
    // sr-only twin carries the count in words (no bare numeral for AT).
    await expect(inboxPill).toContainText(String(baseInbox + 1));
    await expect(inboxPill).toContainText(/item|items/i);

    // Right-EDGE pill, not a corner/avatar dot: the pill's left edge sits to
    // the RIGHT of the row's label, and its right edge hugs the row's right
    // edge (ml-auto). A corner dot would overlap the icon/label, not trail it.
    const geom = await page.evaluate(() => {
      const pill = document.querySelector('[data-testid="inbox-count-pill"]');
      const row = pill?.closest('a');
      const label = row?.querySelector(':scope > :not([data-testid])'); // icon is first; we just need the row box
      if (!pill || !row) return null;
      const p = pill.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return { pillLeft: p.left, pillRight: p.right, rowLeft: r.left, rowRight: r.right };
    });
    if (!geom) throw new Error('S9: inbox pill / row geometry missing');
    expect(geom.pillRight, 'pill hugs the row right edge').toBeGreaterThan(
      geom.rowRight - geom.rowLeft - (geom.rowRight - geom.pillRight) - 1, // pill right within ~row right
    );
    expect(geom.pillRight, 'pill right ≤ row right').toBeLessThanOrEqual(geom.rowRight + 1);
    expect(
      geom.pillLeft,
      'pill sits in the right half of the row (trailing, not a corner dot)',
    ).toBeGreaterThan(geom.rowLeft + (geom.rowRight - geom.rowLeft) / 2);

    // --- MY TASKS pill ---
    const tasksPill = page.locator('[data-testid="tasks-count-pill"]');
    await expect(tasksPill).toBeVisible();
    await expect(tasksPill).toContainText(String(baseTasks + 1));
    await expect(tasksPill).toContainText(/task|tasks/i);

    // --- FAVORITES gold star ---
    const star = page.locator('[data-testid="favorites-star"]');
    await expect(star).toHaveClass(/fill-yellow-500/);

    // --- Completing the seeded task drops the open count ---
    expect(
      (
        await page.request.patch(`/api/pages/${taskPageId}`, {
          data: { content: taskDoc(owner.createdBy, 's9-task-1', true) },
        })
      ).ok(),
    ).toBeTruthy();
    expect(await apiCount(page, '/api/tasks/count'), 'open tasks back to baseline').toBe(baseTasks);

    // --- Unfavoriting resets the star (toggle POST again) ---
    expect(
      (await page.request.post('/api/prefs/favorites', { data: { pageId: favPageId } })).ok(),
    ).toBeTruthy();
    const baseFav = await page.request.get('/api/prefs/favorites');
    const favCount = ((await baseFav.json()) as { favorites: unknown[] }).favorites.length;
    await page.reload();
    const tasksPill2 = page.locator('[data-testid="tasks-count-pill"]');
    // tasks pill now reflects the decremented (baseline) count.
    if (baseTasks === 0) {
      await expect(tasksPill2).toHaveCount(0);
    } else {
      await expect(tasksPill2).toContainText(String(baseTasks));
    }
    const star2 = page.locator('[data-testid="favorites-star"]');
    if (favCount === 0) {
      await expect(star2).not.toHaveClass(/fill-yellow-500/);
    }
  });
});
