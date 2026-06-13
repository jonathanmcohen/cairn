// v0.10.2 F1 Task C — runtime spec for the flashcards OVERVIEW + ORPHANS
// surfaces. Drives the REAL browser through the proxy against the seeded stack.
// The orphan machinery is new on this branch (page permanent-delete SET-NULLs +
// stamps cards orphaned instead of cascade-deleting them; block removal stamps
// orphaned; the trash soft-delete pulls cards from the due queue), so these are
// RED on main today.
//
// Coverage:
//   1. Permanently delete a page with cards → cards get source_orphaned_at,
//      page_id NULL, review rows SURVIVE, and appear in /flashcards/orphans.
//   2. Trash (soft) a page with due cards → cards LEAVE the due queue and study;
//      restore → they return, schedule untouched, NOT orphaned.
//   3. Remove a flashcard block from a live page → card orphan-marked (appears
//      in orphans), NOT destroyed; review history intact.
//   4. Orphan resolutions: reattach via the picker (re-enters the due queue),
//      keep-standalone (flag cleared, studies with no source), delete (gone).
//
// e2e hygiene (the dev DB persists across runs): every fixture front/back/title
// carries a per-run `stamp` so prior runs' rows can't collide, and selectors are
// scoped by stamped text so accumulated cards never make a match ambiguous.
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor, pmDoc, pmParagraph } from './util';

const OVERVIEW = '/flashcards';
const ORPHANS = '/flashcards/orphans';
const STUDY = '/flashcards/study';

/** A flashcard TipTap node (the reconcile loop turns these into card rows on save). */
function flashcardNode(blockId: string, front: string, back: string): Record<string, unknown> {
  return { type: 'flashcard', attrs: { blockId, front, back, deckTag: null } };
}

/** Locate an orphans-table row by its (stamped, unique) front text. */
function orphanRowByFront(page: import('@playwright/test').Page, front: string) {
  return page.locator('[data-testid="flashcards-orphans-row"]', { hasText: front });
}

/**
 * True if a card with `front` is currently in the workspace due queue. Reads the
 * due JSON directly (the deterministic source of truth) rather than the study UI,
 * which only renders one card at a time from the front of the queue.
 */
async function isDue(page: import('@playwright/test').Page, front: string): Promise<boolean> {
  const due = await page.request.get('/api/flashcards/due');
  if (!due.ok()) return false;
  const body = (await due.json()) as { due: { front: string }[] };
  return body.due.some((c) => c.front === front);
}

type ManageCard = { front: string; pageId: string | null; sourceOrphanedAt: string | null };

/**
 * Look up a single card on the manage surface by its (stamped, unique) front.
 * The manage API exposes `pageId` and `sourceOrphanedAt`, which is how we assert
 * orphan-resolution outcomes that the due queue can't show: a kept-standalone
 * card has `pageId === null`, so it never appears in /api/flashcards/due (that
 * query INNER-JOINs pages). Returns `null` until the card materializes.
 */
async function manageCardByFront(
  page: import('@playwright/test').Page,
  front: string,
): Promise<ManageCard | null> {
  const res = await page.request.get(`/api/flashcards/manage?search=${encodeURIComponent(front)}`);
  if (!res.ok()) return null;
  const body = (await res.json()) as { cards: ManageCard[] };
  return body.cards.find((c) => c.front === front) ?? null;
}

/** Grade the first card in the study queue once (Show answer → Good). */
async function gradeOneInStudy(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(STUDY);
  await page
    .getByRole('button', { name: /show answer/i })
    .first()
    .click();
  await page.getByRole('button', { name: /^good$/i }).click();
}

test.describe('item F1 — flashcards orphans + overview', () => {
  test('permanent page delete orphans its cards but keeps review history', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const front = `permdel-${stamp}`;
    const anchor = `f1 permdel anchor ${stamp}`;

    const pageId = await createPageViaApi(
      page,
      `F1 permdel ${stamp}`,
      pmDoc(pmParagraph(anchor), flashcardNode(`pblk-${stamp}`, front, `back-${stamp}`)),
    );
    // Open the editor so the planted node has reconciled into a card row.
    await openPageEditor(page, pageId, anchor);

    // Grade the card once so it carries a review row (history that must survive).
    await gradeOneInStudy(page);

    // Soft-delete then permanently delete the page through the real REST routes
    // (the same ones the trash UI calls). The hard-delete stamps the page's
    // cards orphaned BEFORE the SET-NULL FK fires.
    let res = await page.request.delete(`/api/pages/${pageId}`);
    expect(res.ok(), `soft-delete failed: ${res.status()}`).toBe(true);
    res = await page.request.delete(`/api/trash/${pageId}`);
    expect(res.ok(), `hard-delete failed: ${res.status()}`).toBe(true);

    // The card now shows on the orphans surface, with its review state intact.
    // (A graded card's exact state label depends on interval, so assert the row
    // is listed and its state cell is rendered rather than pinning a label.)
    await page.goto(ORPHANS);
    await expect(page.getByTestId('flashcards-orphans-table')).toBeVisible({ timeout: 30_000 });
    await expect(orphanRowByFront(page, front)).toHaveCount(1, { timeout: 15_000 });
    // Review history survived: the state cell is rendered (not blank). A graded
    // card with interval 1 is "Learning"; assert the cell is non-empty.
    await expect(orphanRowByFront(page, front).getByTestId('cell-state')).not.toHaveText('', {
      timeout: 15_000,
    });
  });

  test('trashing a page pulls its due cards from study; restore returns them un-orphaned', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const front = `trash-${stamp}`;
    const anchor = `f1 trash anchor ${stamp}`;

    const pageId = await createPageViaApi(
      page,
      `F1 trash ${stamp}`,
      pmDoc(pmParagraph(anchor), flashcardNode(`tblk-${stamp}`, front, `back-${stamp}`)),
    );
    await openPageEditor(page, pageId, anchor);

    // The brand-new card is immediately due. Assert membership via the due API
    // directly, NOT the study UI: the study page renders one card at a time from
    // the FRONT of the whole-workspace queue (dozens of seeded cards), so our
    // stamped card is almost never the one on screen. The due JSON is the
    // deterministic source of truth.
    await expect.poll(() => isDue(page, front), { timeout: 30_000 }).toBe(true);

    // Soft-delete (trash) the page → the card leaves the due queue (the due
    // route INNER-JOINs pages on deleted_at IS NULL).
    let res = await page.request.delete(`/api/pages/${pageId}`);
    expect(res.ok(), `soft-delete failed: ${res.status()}`).toBe(true);

    // Absent from the due queue while the page is trashed.
    await expect.poll(() => isDue(page, front), { timeout: 15_000 }).toBe(false);

    // It is NOT orphaned (trash is reversible) — absent from /flashcards/orphans.
    await page.goto(ORPHANS);
    await expect(page.getByTestId('flashcards-orphans')).toBeVisible({ timeout: 30_000 });
    await expect(orphanRowByFront(page, front)).toHaveCount(0);

    // Restore the page → the card returns to the due queue, schedule untouched.
    res = await page.request.post(`/api/pages/${pageId}/restore`);
    expect(res.ok(), `restore failed: ${res.status()}`).toBe(true);
    await expect.poll(() => isDue(page, front), { timeout: 15_000 }).toBe(true);
  });

  test('removing a flashcard block from a live page orphans the card, keeps history', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const front = `blockrm-${stamp}`;
    const anchor = `f1 blockrm anchor ${stamp}`;
    const blockId = `rblk-${stamp}`;

    const pageId = await createPageViaApi(
      page,
      `F1 blockrm ${stamp}`,
      pmDoc(pmParagraph(anchor), flashcardNode(blockId, front, `back-${stamp}`)),
    );
    await openPageEditor(page, pageId, anchor);

    // Grade once so the card carries review history the orphan-mark must keep.
    await gradeOneInStudy(page);

    // Remove the flashcard block: PATCH the page content to a doc WITHOUT the
    // flashcard node. The page-save reconcile loop (reconcileFlashcards) stamps
    // the now-removed block's card source_orphaned_at — it does NOT delete it,
    // so the review row survives.
    const removed = await page.request.patch(`/api/pages/${pageId}`, {
      data: { content: pmDoc(pmParagraph(anchor)) },
    });
    expect(removed.ok(), `block-removal PATCH failed: ${removed.status()}`).toBe(true);

    // The card now surfaces in orphans (NOT destroyed).
    await page.goto(ORPHANS);
    await expect(page.getByTestId('flashcards-orphans-table')).toBeVisible({ timeout: 30_000 });
    await expect(orphanRowByFront(page, front)).toHaveCount(1, { timeout: 15_000 });
    // Review history intact → the state cell is non-empty (graded card).
    await expect(orphanRowByFront(page, front).getByTestId('cell-state')).not.toHaveText('', {
      timeout: 15_000,
    });
  });

  test('orphan resolutions: reattach (picker), keep-standalone, delete', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const reattachFront = `reatt-${stamp}`;
    const keepFront = `keep-${stamp}`;
    const deleteFront = `del-${stamp}`;
    const anchor = `f1 resolve anchor ${stamp}`;

    // One page with three flashcards; remove all three blocks to orphan them.
    const pageId = await createPageViaApi(
      page,
      `F1 resolve ${stamp}`,
      pmDoc(
        pmParagraph(anchor),
        flashcardNode(`rblk1-${stamp}`, reattachFront, `back1-${stamp}`),
        flashcardNode(`rblk2-${stamp}`, keepFront, `back2-${stamp}`),
        flashcardNode(`rblk3-${stamp}`, deleteFront, `back3-${stamp}`),
      ),
    );
    await openPageEditor(page, pageId, anchor);

    // A SECOND page to reattach to (search-as-you-type picker target).
    const targetTitle = `F1 reattach target ${stamp}`;
    const targetId = await createPageViaApi(
      page,
      targetTitle,
      pmDoc(pmParagraph(`target ${stamp}`)),
    );

    // Orphan all three by removing their blocks (PATCH content → reconcile).
    const removed = await page.request.patch(`/api/pages/${pageId}`, {
      data: { content: pmDoc(pmParagraph(anchor)) },
    });
    expect(removed.ok(), `orphan PATCH failed: ${removed.status()}`).toBe(true);

    await page.goto(ORPHANS);
    await expect(page.getByTestId('flashcards-orphans-table')).toBeVisible({ timeout: 30_000 });
    for (const f of [reattachFront, keepFront, deleteFront]) {
      await expect(orphanRowByFront(page, f)).toHaveCount(1, { timeout: 15_000 });
    }

    // --- Reattach via the page picker. ---------------------------------------
    await orphanRowByFront(page, reattachFront).getByTestId('orphan-reattach').click();
    const picker = page.getByTestId('orphan-page-picker');
    await expect(picker).toBeVisible({ timeout: 10_000 });
    // Search-as-you-type narrows to the (stamped, unique) target page, then pick.
    await page.getByTestId('orphan-page-picker-input').fill(targetTitle);
    const option = page.getByTestId('orphan-page-picker-option').filter({ hasText: targetTitle });
    await expect(option).toHaveCount(1, { timeout: 15_000 });
    await option.click();
    // Resolved → leaves the orphans list.
    await expect(orphanRowByFront(page, reattachFront)).toHaveCount(0, { timeout: 15_000 });
    // Re-entered the due queue (its source link works again): present in due.
    await expect
      .poll(
        async () => {
          const due = await page.request.get('/api/flashcards/due');
          const body = (await due.json()) as { due: { front: string; pageId: string | null }[] };
          return body.due.some((c) => c.front === reattachFront && c.pageId === targetId);
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // --- Keep standalone. ----------------------------------------------------
    await orphanRowByFront(page, keepFront).getByTestId('orphan-keep').click();
    await expect(orphanRowByFront(page, keepFront)).toHaveCount(0, { timeout: 15_000 });
    // Resolved: `keepStandalone` clears the orphan flag in place (it ONLY sets
    // source_orphaned_at = NULL; it does not touch page_id). We assert via the
    // manage API, NOT the due queue: keep-standalone is a UI-state change, and
    // whether the card re-enters the due queue depends on its page_id (left as
    // the block-removal path found it — these cards' source page still exists),
    // which is not what this resolution is about. The resolution is: no longer
    // orphaned.
    await expect
      .poll(async () => (await manageCardByFront(page, keepFront))?.sourceOrphanedAt, {
        timeout: 15_000,
      })
      .toBeNull();

    // --- Delete. -------------------------------------------------------------
    await orphanRowByFront(page, deleteFront).getByTestId('orphan-delete').click();
    await expect(orphanRowByFront(page, deleteFront)).toHaveCount(0, { timeout: 15_000 });
    // Gone for good: a reload still shows no such orphan row.
    await page.goto(ORPHANS);
    await expect(page.getByTestId('flashcards-orphans')).toBeVisible({ timeout: 30_000 });
    await expect(orphanRowByFront(page, deleteFront)).toHaveCount(0);
  });

  test('overview shows headline counts and links into the section', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const front = `ov-${stamp}`;
    const anchor = `f1 ov anchor ${stamp}`;

    const pageId = await createPageViaApi(
      page,
      `F1 overview ${stamp}`,
      pmDoc(pmParagraph(anchor), flashcardNode(`oblk-${stamp}`, front, `back-${stamp}`)),
    );
    await openPageEditor(page, pageId, anchor);

    await page.goto(OVERVIEW);
    const overview = page.getByTestId('flashcards-overview');
    await expect(overview).toBeVisible({ timeout: 30_000 });
    // Title is i18n `flashcards.overview.title` = "Flashcards".
    await expect(overview.getByRole('heading', { name: 'Flashcards', level: 1 })).toBeVisible();
    // The three headline counts render (due / new / mature); the new card makes
    // "due now" >= 1. The count card testids are count-due / count-new /
    // count-mature, each with a `${testid}-value` inner value node.
    await expect(page.getByTestId('flashcards-counts')).toBeVisible();
    await expect(overview.getByTestId('count-new')).toBeVisible();
    await expect(overview.getByTestId('count-mature')).toBeVisible();
    await expect
      .poll(async () => Number(await overview.getByTestId('count-due-value').innerText()), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(1);

    // The in-page section nav links reach manage + orphans. Scope to the overview
    // container: the sidebar nav also renders "Manage flashcards" / "Orphaned
    // cards" links, so an unscoped role query is ambiguous (strict-mode).
    await overview.getByRole('link', { name: 'Manage', exact: true }).click();
    await expect(page).toHaveURL(/\/flashcards\/manage$/, { timeout: 15_000 });
    await page.goto(OVERVIEW);
    await overview.getByRole('link', { name: 'Orphaned cards', exact: true }).click();
    await expect(page).toHaveURL(/\/flashcards\/orphans$/, { timeout: 15_000 });
  });
});
