// v0.10.2 F1 Task B — runtime spec for the flashcards MANAGE surface. Drives the
// REAL browser through the proxy against the seeded stack: cards are created via
// the real `/flashcard` slash flow AND by planting flashcard nodes in page
// content (which the page-save reconcile loop materializes into flashcard_cards
// rows), then the manage table at /flashcards/manage is asserted to reflect the
// DB rows. Covers filters, search, bulk mutations, typed-delete + 10s undo
// (restoring the card AND its review rows), and CSV export.
//
// e2e hygiene (the dev DB persists across runs): every fixture front/back/deck
// carries a per-run `stamp` so prior runs' rows can't collide, and selectors are
// scoped by stamped text so accumulated cards never make a match ambiguous.
import { expect, signIn, test } from '../a11y/fixtures';
import {
  createPageViaApi,
  openPageEditor,
  pmDoc,
  pmParagraph,
  typeSlashQueryAtDocEnd,
} from './util';

const MANAGE = '/flashcards/manage';

/** A flashcard TipTap node (the reconcile loop turns these into card rows on save). */
function flashcardNode(blockId: string, front: string, back: string): Record<string, unknown> {
  return { type: 'flashcard', attrs: { blockId, front, back, deckTag: null } };
}

/** Locate a manage-table row by its (stamped, unique) front text. */
function rowByFront(page: import('@playwright/test').Page, front: string) {
  return page.locator('[data-testid="flashcards-manage-row"]', { hasText: front });
}

test.describe('item F1 — flashcards manage surface', () => {
  test('create via slash + content, assert cells, filter, search', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const slashFront = `slashQ-${stamp}`;
    const front1 = `front1-${stamp}`;
    const front2 = `front2-${stamp}`;

    // A page with two planted flashcard nodes (reconciled into rows on save).
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
    const editor = await openPageEditor(page, pageId, anchor);

    // --- Create a THIRD card through the real /flashcard slash flow. ---------
    await typeSlashQueryAtDocEnd(page, editor, '/flashcard');
    await page.getByRole('option').filter({ hasText: 'Flashcard' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.locator('#editor-dialog-front').fill(slashFront);
    await page.locator('#editor-dialog-back').fill(`slashA-${stamp}`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    // The inserted node renders its front in the editor preview.
    await expect(
      editor.locator('[data-testid="flashcard-face"]', { hasText: slashFront }),
    ).toBeVisible({ timeout: 15_000 });

    // --- Manage table reflects all three cards. ------------------------------
    await page.goto(MANAGE);
    await expect(page.getByTestId('flashcards-manage-table')).toBeVisible({ timeout: 30_000 });
    for (const f of [slashFront, front1, front2]) {
      await expect(rowByFront(page, f)).toHaveCount(1, { timeout: 15_000 });
    }
    // Cells: a planted card shows its source page link + a "new" state + 0 reps.
    const r1 = rowByFront(page, front1);
    await expect(r1.getByTestId('cell-source-link')).toBeVisible();
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

    await page.goto(MANAGE);
    const row = rowByFront(page, front);
    await expect(row).toHaveCount(1, { timeout: 30_000 });

    // Grade the card once via the study UI so it carries a review row (state +
    // reps), which the undo must bring back.
    await page.goto('/flashcards/study');
    await page
      .getByRole('button', { name: /show answer/i })
      .first()
      .click();
    await page.getByRole('button', { name: /^good$/i }).click();

    // Back to manage — the row now shows reps 1.
    await page.goto(MANAGE);
    await expect(rowByFront(page, front).getByTestId('cell-reps')).toHaveText('1', {
      timeout: 30_000,
    });

    // Open the per-row delete → typed-confirm dialog.
    await rowByFront(page, front).getByTestId('row-actions-trigger').click();
    await page.getByTestId('row-action-delete').click();
    const confirmInput = page.getByTestId('delete-confirm-input');
    await expect(confirmInput).toBeVisible();

    // Wrong text → the confirm button stays disabled (nothing deleted).
    await confirmInput.fill('nope');
    await expect(page.getByTestId('delete-confirm-button')).toBeDisabled();
    await expect(rowByFront(page, front)).toHaveCount(1);

    // Correct text → delete; the row disappears and a 10s undo toast appears.
    await confirmInput.fill('delete');
    await page.getByTestId('delete-confirm-button').click();
    await expect(rowByFront(page, front)).toHaveCount(0, { timeout: 15_000 });

    // Undo restores the card AND its review state (reps 1 survives).
    await page.getByRole('button', { name: /^undo$/i }).click();
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
