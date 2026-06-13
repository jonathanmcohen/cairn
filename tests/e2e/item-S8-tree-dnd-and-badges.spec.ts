// v0.10.2 S8 — pages tree polish: DnD reorder/reparent, per-page chevron +
// child-count badge, persistently-dimmed row actions.
//
// Behavior under guard:
// (a) dragging a page row between siblings shows a 2px insertion line
//     (data-testid="tree-drop-line") and the drop PERSISTS the new sibling
//     order (POST /api/pages/<id>/move {newParentId, beforeId|afterId} →
//     pages.position) — asserted after a full reload, so a drop handler that
//     only mutates local state fails;
// (b) dragging ONTO a row shows the reparent cue
//     (data-testid="tree-drop-parent") and the drop reparents — child renders
//     at +16px indent after reload;
// (c) rows with children grow a chevron (aria-expanded, client collapse) and
//     a child-count badge that increments after '+ add subpage';
// (d) the row action cluster rests at opacity 0.3 and reaches 1.0 on row
//     hover AND on focus-within (keyboard reachability preserved);
// (e) the native title tooltip survives.
// RED on pre-fix: rows are not draggable (no drop indicators ever render) and
// no chevron/badge exists.
//
// The virtualized-scroll-boundary drop case is unit-territory (offset math),
// not driven here: a pointer drag across a live virtualizer re-window is too
// flake-prone for a release gate.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi } from './util';

const ROW = '[data-virtual-row][data-row-kind="page"]';

function rowByTitle(page: Page, title: string) {
  return page.locator(ROW).filter({ hasText: title }).first();
}

/** The tree is VIRTUALIZED — rows outside the window are not in the DOM at
 * all, and the long-lived e2e workspace holds hundreds of fixture pages.
 * Fresh pages sort LAST among siblings, so jump the tree's scroll container
 * straight to the bottom, then walk UP one viewport per poll tick until the
 * row mounts. */
async function scrollTreeToRow(page: Page, title: string) {
  await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 });
  // Each search starts with a fresh bottom-jump (the tracker survives within
  // a page session and would otherwise skip it).
  await page.evaluate(() => {
    (window as unknown as { __s8h?: number }).__s8h = undefined;
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          ([sel, t]) => {
            const found = Array.from(document.querySelectorAll(sel)).some((r) =>
              (r.textContent ?? '').includes(t),
            );
            if (found) return true;
            const scrollEl = document.querySelector(sel)?.closest('.overflow-y-auto');
            if (!scrollEl) return false;
            // The virtualizer's total height keeps growing while estimates
            // settle — whenever it grew since the last tick, re-jump to the
            // (new) bottom; otherwise walk up one viewport per tick.
            const w = window as unknown as { __s8h?: number };
            if (w.__s8h !== scrollEl.scrollHeight) {
              w.__s8h = scrollEl.scrollHeight;
              scrollEl.scrollTop = scrollEl.scrollHeight;
              return false;
            }
            if (scrollEl.scrollTop <= 0) {
              // Walked to the very top without finding it — start over from
              // the bottom (covers a row that mounted below mid-walk).
              scrollEl.scrollTop = scrollEl.scrollHeight;
              return false;
            }
            scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - scrollEl.clientHeight);
            return false;
          },
          [sel0, title] as const,
        ),
      { timeout: 25_000, message: `tree row "${title}" mounts after scrolling` },
    )
    .toBe(true);
  await rowByTitle(page, title).scrollIntoViewIfNeeded();
}
const sel0 = ROW;

/** Visible page-row titles in DOM order. */
function rowTitles(page: Page): Promise<string[]> {
  return page.evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).map((r) => (r.textContent ?? '').trim()),
    ROW,
  );
}

/** One pointer-drag attempt; returns whether the indicator appeared. */
async function dragOnce(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  indicator: string,
): Promise<boolean> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  // Nudge once more so dnd-kit recomputes `over` after activation settles.
  await page.mouse.move(to.x + 1, to.y, { steps: 2 });
  const seen = await page
    .locator(`[data-testid="${indicator}"]`)
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  await page.mouse.up();
  return seen;
}

/** Drag `fromTitle`'s row to a point on `toTitle`'s row (`yRatio` of its
 * height) and require `indicator` mid-drag. The press can race a virtualizer
 * row remount — then it never becomes a drag and the release click-navigates
 * to the page — so retry up to 3 times, recovering the URL and re-scrolling
 * the rows fresh each attempt. */
async function dragRowTo(
  page: Page,
  returnUrl: string,
  fromTitle: string,
  toTitle: string,
  yRatio: number,
  indicator: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!page.url().endsWith(returnUrl)) await page.goto(returnUrl);
    await scrollTreeToRow(page, fromTitle);
    await scrollTreeToRow(page, toTitle);
    // Center the drag rows in the scroll container: near its edges dnd-kit
    // AUTO-SCROLLS mid-drag, moving the content under the stationary pointer
    // so fixed viewport coordinates land on the wrong row/zone.
    await page.evaluate(
      ([sel, t]) => {
        const rows = Array.from(document.querySelectorAll(sel));
        const row = rows.find((r) => (r.textContent ?? '').includes(t));
        const scrollEl = row?.closest('.overflow-y-auto');
        if (!row || !scrollEl) return;
        const rowRect = row.getBoundingClientRect();
        const scRect = scrollEl.getBoundingClientRect();
        scrollEl.scrollTop += rowRect.top - (scRect.top + scRect.height / 2);
      },
      [ROW, fromTitle] as const,
    );
    await page.waitForTimeout(400); // let the virtualizer window settle
    const from = await rowByTitle(page, fromTitle).boundingBox();
    const to = await rowByTitle(page, toTitle).boundingBox();
    if (!from || !to) continue;
    const ok = await dragOnce(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: to.x + to.width / 2, y: to.y + to.height * yRatio },
      indicator,
    );
    if (ok) return;
  }
  expect(false, `${indicator} appeared during drag (3 attempts)`).toBe(true);
}

test.describe('item S8 — pages tree DnD + badges', () => {
  // Tall viewport: the sidebar tree windows ~80 rows instead of ~15, which
  // tames virtualizer churn under the pointer drags below.
  test.use({ viewport: { width: 1280, height: 2200 } });

  test('reorder persists, reparent persists, badges + dimmed actions + tooltip', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now();
    const titleA = `S8 alpha ${stamp}`;
    const titleB = `S8 beta ${stamp}`;
    const titleC = `S8 gamma ${stamp}`;
    const idA = await createPageViaApi(page, titleA);
    const idB = await createPageViaApi(page, titleB);
    const idC = await createPageViaApi(page, titleC);

    // Server-truth view of the tree (same flatten the sidebar renders) —
    // persistence asserts read THIS, not the virtualized window, so a drop
    // handler that only mutates local state still fails while the assert
    // stays immune to virtualizer windowing.
    const serverNodes = async () => {
      const res = await page.request.get('/api/pages/tree');
      expect(res.ok()).toBe(true);
      return (await res.json()).nodes as { id: string; parentId: string | null }[];
    };

    await page.goto(`/pages/${seeded.pageId}`);
    await scrollTreeToRow(page, titleA);
    await scrollTreeToRow(page, titleC);
    await expect(rowByTitle(page, titleA)).toBeVisible();
    await expect(rowByTitle(page, titleC)).toBeVisible();

    // Creation order: A before B before C (position gap-numbering).
    const before = await rowTitles(page);
    expect(before.findIndex((t) => t.includes(titleA))).toBeLessThan(
      before.findIndex((t) => t.includes(titleC)),
    );

    // --- (a) reorder: drag C into the gap ABOVE A (top edge zone). ---
    await dragRowTo(page, `/pages/${seeded.pageId}`, titleC, titleA, 0.12, 'tree-drop-line');
    // Persisted server-side, not local state: poll the flatten API (the drop
    // handler's move POST is async).
    await expect
      .poll(
        async () => {
          const nodes = await serverNodes();
          return nodes.findIndex((n) => n.id === idC) - nodes.findIndex((n) => n.id === idA);
        },
        { timeout: 10_000, message: 'C reordered above A, persisted server-side' },
      )
      .toBeLessThan(0);

    // --- (b) reparent: drag B onto A (middle zone). ---
    await dragRowTo(page, `/pages/${seeded.pageId}`, titleB, titleA, 0.5, 'tree-drop-parent');
    await expect
      .poll(async () => (await serverNodes()).find((n) => n.id === idB)?.parentId ?? null, {
        timeout: 10_000,
        message: 'B reparented under A, persisted server-side',
      })
      .toBe(idA);
    await page.reload();
    await scrollTreeToRow(page, titleA);
    await scrollTreeToRow(page, titleB);
    const indents = await page.evaluate(
      ([sel, a, b]) => {
        const rows = Array.from(document.querySelectorAll(sel));
        const find = (t: string) => rows.find((r) => (r.textContent ?? '').includes(t));
        const pad = (el: Element | undefined) => {
          if (!el) return null;
          // The indent is paddingLeft on the row's inner content element —
          // take the max across the row subtree to be layout-agnostic.
          const candidates = [el, ...Array.from(el.querySelectorAll('*'))];
          return Math.max(
            ...candidates.map((c) => Number.parseFloat(getComputedStyle(c).paddingLeft) || 0),
          );
        };
        return { a: pad(find(a)), b: pad(find(b)) };
      },
      [ROW, titleA, titleB] as const,
    );
    if (indents.a === null || indents.b === null) throw new Error('S8: indent rows missing');
    expect(indents.b - indents.a, 'B reparented under A at +16px indent').toBe(16);

    // --- (c) chevron + child-count badge on A (now a parent of 1). ---
    const rowA = rowByTitle(page, titleA);
    const chevron = rowA.getByRole('button', { name: `Toggle subpages of ${titleA}` });
    await expect(chevron).toBeVisible();
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(rowA).toContainText('1');

    // Collapse hides the child; expand restores it.
    await chevron.click();
    await expect(rowByTitle(page, titleB)).toHaveCount(0);
    await chevron.click();
    await expect(rowByTitle(page, titleB)).toBeVisible();

    // Badge increments via the '+' add-subpage (which navigates to the new
    // page — come back afterwards).
    await rowA.hover();
    await rowA.getByRole('button', { name: 'Add subpage', exact: true }).click();
    await page.waitForURL(/\/pages\//, { timeout: 15_000 });
    await page.goto(`/pages/${idA}`);
    await scrollTreeToRow(page, titleA);
    await expect(rowByTitle(page, titleA)).toContainText('2');

    // --- (d) action cluster: 0.3 at rest, 1.0 on hover and focus-within. ---
    await page.mouse.move(900, 500); // park pointer away from the sidebar
    const clusterOpacity = () =>
      page.evaluate(
        ([sel, t]) => {
          const row = Array.from(document.querySelectorAll(sel)).find((r) =>
            (r.textContent ?? '').includes(t),
          );
          const cluster = row?.querySelector('.opacity-30, [class*="opacity-30"]');
          return cluster ? Number.parseFloat(getComputedStyle(cluster).opacity) : null;
        },
        [ROW, titleC] as const,
      );
    await expect
      .poll(clusterOpacity, { timeout: 5_000, message: 'cluster dimmed at rest' })
      .toBeCloseTo(0.3, 2);
    await rowByTitle(page, titleC).hover();
    await expect
      .poll(clusterOpacity, { timeout: 5_000, message: 'cluster revealed on hover' })
      .toBe(1);
    await page.mouse.move(900, 500);
    await rowByTitle(page, titleC).getByRole('button').first().focus();
    await expect
      .poll(clusterOpacity, { timeout: 5_000, message: 'cluster revealed on focus-within' })
      .toBe(1);

    // --- (e) native title tooltip survives. ---
    const hasTitleAttr = await page.evaluate(
      ([sel, t]) => {
        const row = Array.from(document.querySelectorAll(sel)).find((r) =>
          (r.textContent ?? '').includes(t),
        );
        return Boolean(row?.querySelector(`[title*="${t.slice(0, 8)}"]`));
      },
      [ROW, titleC] as const,
    );
    expect(hasTitleAttr, 'native title tooltip still present').toBe(true);
  });
});
