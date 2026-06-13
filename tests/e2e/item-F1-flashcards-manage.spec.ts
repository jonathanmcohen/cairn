// v0.10.2 F1 Task B — runtime spec for the flashcards MANAGE surface. Drives the
// REAL browser through the proxy against the seeded stack: cards are materialized
// by planting flashcard nodes in page content (the page-save reconcile loop turns
// these into flashcard_cards rows on PATCH), then the manage table at
// /flashcards/manage is asserted to reflect the DB rows. Covers filters, search,
// bulk mutations, typed-delete + 10s undo (restoring the card AND its review
// rows), and CSV export.
//
// The `/flashcard` slash flow is deliberately NOT exercised here: it inserts via
// an async lazy-loaded extension that is selection-dependent, which is unreliable
// in e2e (see slash-extension.ts `ensureLazyExtension`). The planted-node path is
// the reliable way to create cards, and it covers the same DB → manage-table
// contract these assertions care about.
//
// e2e hygiene (the dev DB persists across runs): every fixture front/back/deck
// carries a per-run `stamp` so prior runs' rows can't collide, and selectors are
// scoped by stamped text so accumulated cards never make a match ambiguous.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor, pmDoc, pmParagraph } from './util';

const MANAGE = '/flashcards/manage';

/** A flashcard TipTap node (the reconcile loop turns these into card rows on save). */
function flashcardNode(blockId: string, front: string, back: string): Record<string, unknown> {
  return { type: 'flashcard', attrs: { blockId, front, back, deckTag: null } };
}

/** Locate a manage-table row by its (stamped, unique) front text. */
function rowByFront(page: Page, front: string) {
  return page.locator('[data-testid="flashcards-manage-row"]', { hasText: front });
}

/**
 * Grade a single, specific card deterministically by POSTing the real grade API
 * (the same route the study UI calls). The study UI shows ONE card at a time
 * starting at the front of the whole-workspace due queue — against the seeded
 * stack (dozens of due cards) the first card shown is almost never the one under
 * test, so grading "the first card" would grade an unrelated seeded card. We
 * look the card up by its stamped front via the manage API, then grade by id.
 * Grade 2 ("Good") records one repetition (reps → 1).
 */
async function cardIdByFront(page: Page, front: string): Promise<string> {
  const res = await page.request.get(`/api/flashcards/manage?search=${encodeURIComponent(front)}`);
  if (!res.ok()) return '';
  const body = (await res.json()) as { cards: { id: string; front: string }[] };
  return body.cards.find((c) => c.front === front)?.id ?? '';
}

async function gradeCardByFront(page: Page, front: string): Promise<void> {
  // The planted node only reconciles into a card row after the editor opens, so
  // poll the manage API until the stamped card exists, then grade it by id.
  let cardId = '';
  await expect
    .poll(
      async () => {
        cardId = await cardIdByFront(page, front);
        return cardId;
      },
      { timeout: 30_000 },
    )
    .not.toBe('');
  const graded = await page.request.post('/api/flashcards/grade', {
    data: { cardId, grade: 2 },
  });
  expect(graded.ok(), `grade failed: ${graded.status()}`).toBe(true);
}

test.describe('item F1 — flashcards manage surface', () => {
  test('planted cards populate the manage table; cells, filter, search', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const front1 = `front1-${stamp}`;
    const front2 = `front2-${stamp}`;

    // A page with two planted flashcard nodes; opening the editor runs the
    // reconcile-on-save loop that materializes them into flashcard_cards rows.
    const anchor = `f1 anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `F1 manage ${stamp}`,
      pmDoc(
        pmParagraph(anchor),
        flashcardNode(`blk1-${stamp}`, front1, `back1-${stamp}`),
        flashcardNode(`blk2-${stamp}`, front2, `back2-${stamp}`),
      ),
    );
    // Open the page so its content is loaded (the flashcard extension renders
    // lazily, so we don't assert the in-editor face here — the manage table
    // below is the real proof the planted nodes reconciled into card rows).
    await openPageEditor(page, pageId, anchor);

    // --- Manage table reflects both planted cards. ---------------------------
    await page.goto(MANAGE);
    await expect(page.getByTestId('flashcards-manage-table')).toBeVisible({ timeout: 30_000 });
    for (const f of [front1, front2]) {
      await expect(rowByFront(page, f)).toHaveCount(1, { timeout: 15_000 });
    }
    // Cells: a planted card shows its source page link + a "new" state + 0 reps.
    const r1 = rowByFront(page, front1);
    await expect(r1.getByTestId('cell-source-link')).toBeVisible();
    await expect(r1.getByTestId('cell-state')).toHaveText(/new/i);
    await expect(r1.getByTestId('cell-reps')).toHaveText('0');

    // --- Search narrows to one. ----------------------------------------------
    await page.getByPlaceholder(/search front or back/i).fill(front2);
    await expect(rowByFront(page, front2)).toHaveCount(1, { timeout: 15_000 });
    await expect(rowByFront(page, front1)).toHaveCount(0);
    // Clear the search to restore the full set.
    await page.getByPlaceholder(/search front or back/i).fill('');
    await expect(rowByFront(page, front1)).toHaveCount(1, { timeout: 15_000 });
  });

  test('bulk move-to-deck, add tag, suspend, reset', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const front = `bulk-${stamp}`;
    const deckName = `Deck-${stamp}`;

    const anchor = `f1 bulk anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `F1 bulk ${stamp}`,
      pmDoc(pmParagraph(anchor), flashcardNode(`bblk-${stamp}`, front, `back-${stamp}`)),
    );
    await openPageEditor(page, pageId, anchor);

    await page.goto(MANAGE);
    const row = rowByFront(page, front);
    await expect(row).toHaveCount(1, { timeout: 30_000 });

    // Create a deck through the manage UI ("New deck" → in-app prompt dialog).
    await page.getByRole('button', { name: /new deck/i }).click();
    await page.locator('#input-dialog-field').fill(deckName);
    await page.getByRole('button', { name: 'OK' }).click();

    // Select the card → bulk bar appears.
    await row.getByRole('checkbox').check();
    const bar = page.getByTestId('flashcards-bulk-bar');
    await expect(bar).toBeVisible();

    // Move to the new deck.
    await bar.getByRole('button', { name: /move to deck/i }).click();
    await page.getByRole('menuitem', { name: deckName }).click();
    await expect(rowByFront(page, front).getByTestId('cell-deck')).toHaveText(deckName, {
      timeout: 15_000,
    });

    // Add a tag.
    await rowByFront(page, front).getByRole('checkbox').check();
    await page
      .getByTestId('flashcards-bulk-bar')
      .getByRole('button', { name: /add tag/i })
      .click();
    await page.locator('#input-dialog-field').fill(`tag-${stamp}`);
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(rowByFront(page, front).getByTestId('cell-tags')).toContainText(`tag-${stamp}`, {
      timeout: 15_000,
    });

    // Suspend → state cell flips to "Suspended".
    await rowByFront(page, front).getByRole('checkbox').check();
    await page
      .getByTestId('flashcards-bulk-bar')
      .getByRole('button', { name: /^suspend$/i })
      .click();
    await expect(rowByFront(page, front).getByTestId('cell-state')).toHaveText(/suspended/i, {
      timeout: 15_000,
    });

    // Reset → due/interval/reps reset (interval 0).
    await rowByFront(page, front).getByRole('checkbox').check();
    await page.getByTestId('flashcards-bulk-bar').getByRole('button', { name: /reset/i }).click();
    await expect(rowByFront(page, front).getByTestId('cell-interval')).toHaveText('0', {
      timeout: 15_000,
    });
  });

  test('typed-delete confirmation + 10s undo restores the card and its reviews', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const front = `del-${stamp}`;

    const anchor = `f1 del anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `F1 delete ${stamp}`,
      pmDoc(pmParagraph(anchor), flashcardNode(`dblk-${stamp}`, front, `back-${stamp}`)),
    );
    await openPageEditor(page, pageId, anchor);

    // Grade the card once (deterministically, by id) so it carries a review row
    // (state + reps), which the undo must bring back. The study UI shows the
    // front of the whole-workspace due queue, so it can't reliably reach this
    // specific card on the seeded stack — grade by id instead.
    await gradeCardByFront(page, front);

    await page.goto(MANAGE);
    const row = rowByFront(page, front);
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    // The row now shows reps 1 (one graded repetition).
    await expect(rowByFront(page, front).getByTestId('cell-reps')).toHaveText('1', {
      timeout: 30_000,
    });

    // Reach Delete via the bulk bar (select the row's checkbox), not the per-row
    // radix dropdown — that dropdown's enter/exit animation is unstable under
    // headless Playwright. The bulk Delete opens the same typed-confirm dialog.
    await rowByFront(page, front).getByRole('checkbox').check();
    const bar = page.getByTestId('flashcards-bulk-bar');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await bar.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirmInput = page.getByTestId('delete-confirm-input');
    await expect(confirmInput).toBeVisible({ timeout: 10_000 });

    // Wrong text → the confirm button stays disabled (nothing deleted). The
    // dialog phrase is i18n `flashcards.manage.delete.phrase` = "delete".
    await confirmInput.fill('nope');
    await expect(page.getByTestId('delete-confirm-button')).toBeDisabled();
    await expect(rowByFront(page, front)).toHaveCount(1);

    // Correct text → delete (bulk POST), then the 10s undo toast appears.
    await confirmInput.fill('delete');
    await expect(page.getByTestId('delete-confirm-button')).toBeEnabled();
    const [deleteRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/flashcards/manage/bulk') &&
          r.request().method() === 'POST' &&
          (r.request().postData() ?? '').includes('"delete"'),
      ),
      page.getByTestId('delete-confirm-button').click(),
    ]);
    expect(deleteRes.ok(), `delete POST failed: ${deleteRes.status()}`).toBe(true);

    // Undo (the sonner toast's action button, label i18n `flashcards.manage.undo`
    // = "Undo") POSTs the delete snapshot back to `restore`, bringing the card
    // AND its review rows back. Wait for that restore POST to LAND before
    // navigating (a goto would abort the in-flight fetch).
    const undoBtn = page.getByRole('button', { name: /^undo$/i });
    await expect(undoBtn).toBeVisible({ timeout: 8_000 });
    const [restoreRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/flashcards/manage/bulk') &&
          r.request().method() === 'POST' &&
          (r.request().postData() ?? '').includes('"restore"'),
      ),
      undoBtn.click(),
    ]);
    expect(restoreRes.ok(), `restore POST failed: ${restoreRes.status()}`).toBe(true);

    // The card AND its review state came back (reps still 1).
    await page.goto(MANAGE);
    await expect(rowByFront(page, front)).toHaveCount(1, { timeout: 15_000 });
    await expect(rowByFront(page, front).getByTestId('cell-reps')).toHaveText('1', {
      timeout: 15_000,
    });
  });

  test('CSV export downloads the selected cards', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const front = `csv-${stamp}`;

    const anchor = `f1 csv anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `F1 csv ${stamp}`,
      pmDoc(pmParagraph(anchor), flashcardNode(`cblk-${stamp}`, front, `back-${stamp}`)),
    );
    await openPageEditor(page, pageId, anchor);

    await page.goto(MANAGE);
    const row = rowByFront(page, front);
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await row.getByRole('checkbox').check();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /export csv/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });
});
