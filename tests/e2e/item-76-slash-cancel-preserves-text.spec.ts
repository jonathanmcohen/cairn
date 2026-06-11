// v0.9.18 Gate 3 → v0.10.0 B1 — runtime spec for carry-forward item #76.
//
// Behavior under guard (src/components/editor/slash-extension.ts): DEFERRED
// items (footnote/citation/flashcard…) do NOT pre-delete the slash trigger
// range. On commit the range is consumed via consumeSlashRange(); on cancel
// (Escape or the Cancel button) it is consumed via cancelSlashTrigger() — B1
// narrowed the original #76 guarantee to BODY text only. Leaving the `/query`
// trigger after a cancel wedged re-triggering (the suggestion plugin pinned
// `dismissedRange` to the still-present query, and the default
// `allowedPrefixes: [' ']` rejected a new `/` typed after a word char), so the
// trigger is now removed either way; only pre-trigger text and other blocks
// survive untouched.
import { expect, signIn, test } from '../a11y/fixtures';
import {
  createPageViaApi,
  openPageEditor,
  pmDoc,
  pmParagraph,
  typeSlashQueryAtDocEnd,
} from './util';

test.describe('item #76/B1 — slash dialog cancel consumes the trigger, preserves body text', () => {
  test('escaping the /footnote dialog removes the trigger and keeps body text', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const anchor = `item76 anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `Item 76 slash cancel ${stamp}`,
      pmDoc(pmParagraph(anchor)),
    );
    const editor = await openPageEditor(page, pageId, anchor);

    // New paragraph below the anchor, then type the slash query.
    await typeSlashQueryAtDocEnd(page, editor, '/footnote');

    await expect(page.locator('.tippy-box.cairn-slash-popup')).toBeVisible({ timeout: 10_000 });

    // Select the Footnote entry → modal-first flow opens the dialog.
    await page
      .getByRole('option', { name: /Footnote/ })
      .first()
      .click();
    const field = page.getByLabel('Footnote text');
    await expect(field).toBeVisible({ timeout: 10_000 });

    // Cancel with Escape (resolves null on the editor dialog bus).
    await page.keyboard.press('Escape');
    await expect(field).toBeHidden({ timeout: 10_000 });

    // B1: the `/footnote` trigger is CONSUMED on cancel (it was command input,
    // not body text — leaving it wedged re-triggering)…
    await expect(editor.locator('p', { hasText: '/footnote' })).toHaveCount(0, {
      timeout: 10_000,
    });
    // …and the previous block is untouched (no leak into the anchor).
    await expect(editor.locator('p', { hasText: anchor })).toHaveText(anchor);
    // No footnote mark was inserted by the cancelled dialog (the mark renders
    // as <sup data-footnote-id> — src/components/editor/blocks/footnote-mark.ts).
    await expect(editor.locator('sup[data-footnote-id]')).toHaveCount(0);
  });

  // v0.9.19 A2 — the user's actual repro (the v0.9.18 guard tested the wrong
  // path): /equation → Enter → modal opens → click the CANCEL BUTTON (not
  // Escape) → keep typing. The next text must continue in the slash paragraph,
  // not leak into another block — dialog dismissal has to restore the editor
  // selection + focus to the slash trigger.
  test('cancelling the /equation modal by button keeps typing in the slash paragraph', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const anchor = `item76 cancelbtn anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `Item 76 cancel button ${stamp}`,
      pmDoc(pmParagraph(anchor)),
    );
    const editor = await openPageEditor(page, pageId, anchor);

    await typeSlashQueryAtDocEnd(page, editor, '/equation');
    await expect(page.locator('.tippy-box.cairn-slash-popup')).toBeVisible({ timeout: 10_000 });

    // Enter selects the highlighted Equation option → modal-first flow.
    await page.keyboard.press('Enter');
    const latexField = page.getByLabel('LaTeX');
    await expect(latexField).toBeVisible({ timeout: 10_000 });

    // Click the CANCEL button (the repro path — not Escape).
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(latexField).toBeHidden({ timeout: 10_000 });

    // Dismissing the modal returns focus to the editor. (A mouse-click on
    // Cancel keeps the browser's focus machinery busy through the click + the
    // focused button's removal, so the restore lands on the next frame —
    // hence the poll.)
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            type EditorEl = Element & { editor?: { view: { hasFocus(): boolean } } };
            return (
              (
                document.querySelector('.ProseMirror') as EditorEl | null
              )?.editor?.view.hasFocus() ?? false
            );
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Keep typing. The text must continue in the slash paragraph (B1: the
    // consumed trigger leaves it empty, so it now reads exactly "plus more");
    // on v0.9.18 the editor had lost its selection so this leaked into the
    // wrong block.
    await page.keyboard.type('plus more');

    await expect(editor.locator('p', { hasText: 'plus more' })).toHaveText('plus more', {
      timeout: 10_000,
    });
    // The trigger text is gone (consumed on cancel, not merged into the typing).
    await expect(editor.locator('p', { hasText: '/equation' })).toHaveCount(0);
    await expect(editor.locator('p', { hasText: anchor })).toHaveText(anchor);
    // No math node was inserted by the cancelled dialog.
    await expect(editor.locator('[data-math]')).toHaveCount(0);
  });

  // v0.10.0 B1 — the live-deploy sweep's wedge repro: after a cancel, typing
  // `/` must open a FRESH slash menu. Before B1 the preserved `/equation`
  // pinned the suggestion plugin's dismissedRange and the trailing `/` of
  // `/equation/` failed the allowedPrefixes check, so the menu could never
  // re-open (RED on v0.9.19).
  test('after cancel, typing / re-opens the slash menu', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const anchor = `item76 retrigger anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `Item 76 retrigger ${stamp}`,
      pmDoc(pmParagraph(anchor)),
    );
    const editor = await openPageEditor(page, pageId, anchor);
    const popup = page.locator('.tippy-box.cairn-slash-popup');

    await typeSlashQueryAtDocEnd(page, editor, '/equation');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Enter');
    const latexField = page.getByLabel('LaTeX');
    await expect(latexField).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(latexField).toBeHidden({ timeout: 10_000 });

    // The trigger is consumed by the cancel…
    await expect(editor.locator('p', { hasText: '/equation' })).toHaveCount(0, {
      timeout: 10_000,
    });

    // …and a fresh `/` opens the menu again (the wedge is gone).
    await editor.click();
    await page.keyboard.type('/');
    await expect(popup).toBeVisible({ timeout: 10_000 });
  });

  // B1 failure mode: repeat-cancel must not wedge either — cancel twice in a
  // row, then `/` still opens the menu (no stale dismissedRange).
  test('cancelling twice in a row still re-opens the slash menu', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const anchor = `item76 repeat anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `Item 76 repeat cancel ${stamp}`,
      pmDoc(pmParagraph(anchor)),
    );
    const editor = await openPageEditor(page, pageId, anchor);
    const popup = page.locator('.tippy-box.cairn-slash-popup');
    const latexField = page.getByLabel('LaTeX');

    for (let round = 0; round < 2; round += 1) {
      await typeSlashQueryAtDocEnd(page, editor, '/equation');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Enter');
      await expect(latexField).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(latexField).toBeHidden({ timeout: 10_000 });
      await expect(editor.locator('p', { hasText: '/equation' })).toHaveCount(0, {
        timeout: 10_000,
      });
    }

    await editor.click();
    await page.keyboard.type('/');
    await expect(popup).toBeVisible({ timeout: 10_000 });
  });

  // B1 failure mode: text BEFORE the slash survives a cancel — only the
  // trigger is removed (the original #76 guarantee, narrowed to body text).
  test('cancel with text before the slash keeps the body text', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const anchor = `item76 pretext anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `Item 76 pre-text ${stamp}`,
      pmDoc(pmParagraph(anchor)),
    );
    const editor = await openPageEditor(page, pageId, anchor);

    // "hello " first, THEN the slash query in the same paragraph.
    await typeSlashQueryAtDocEnd(page, editor, 'hello ');
    await page.keyboard.type('/equation');
    await expect(page.locator('.tippy-box.cairn-slash-popup')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Enter');
    const latexField = page.getByLabel('LaTeX');
    await expect(latexField).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(latexField).toBeHidden({ timeout: 10_000 });

    // "hello " survives; the `/equation` trigger does not.
    await expect(editor.locator('p', { hasText: 'hello' })).toHaveText(/^hello\s*$/, {
      timeout: 10_000,
    });
    await expect(editor.locator('p', { hasText: '/equation' })).toHaveCount(0);
    await expect(editor.locator('p', { hasText: anchor })).toHaveText(anchor);
  });

  // B1 review gap: nothing previously asserted the trigger is consumed on a
  // SUCCESSFUL insert either — pin both halves of the commit path.
  test('submitting the /equation dialog consumes the trigger and inserts the node', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const anchor = `item76 commit anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `Item 76 commit ${stamp}`,
      pmDoc(pmParagraph(anchor)),
    );
    const editor = await openPageEditor(page, pageId, anchor);

    await typeSlashQueryAtDocEnd(page, editor, '/equation');
    await expect(page.locator('.tippy-box.cairn-slash-popup')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Enter');
    const latexField = page.getByLabel('LaTeX');
    await expect(latexField).toBeVisible({ timeout: 10_000 });

    await latexField.fill('\\frac{1}{2}');
    // Live preview must render before Add enables (slash-ux.spec.ts flow).
    await expect(page.getByTestId('equation-preview').locator('.katex')).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(latexField).toBeHidden({ timeout: 10_000 });

    // Node inserted AND trigger consumed (the previously-unasserted half).
    await expect(editor.locator('[data-math]')).toHaveCount(1, { timeout: 10_000 });
    await expect(editor.locator('p', { hasText: '/equation' })).toHaveCount(0);
    await expect(editor.locator('p', { hasText: anchor })).toHaveText(anchor);
  });
});
