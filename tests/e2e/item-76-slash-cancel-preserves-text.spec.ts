// v0.9.18 Gate 3 — runtime spec for carry-forward item #76 (cancelling a
// deferred slash-item dialog must preserve the typed `/query` text).
//
// Behavior under guard (src/components/editor/slash-extension.ts): DEFERRED
// items (footnote/citation/flashcard…) do NOT pre-delete the slash trigger
// range. The range is consumed via consumeSlashRange() only when the dialog
// resolves with a real insert; Escape/Cancel resolves null and returns early,
// leaving the typed text exactly where it was — no consumed range, no leak of
// the query into the previous block.
import { expect, signIn, test } from '../a11y/fixtures';
import {
  createPageViaApi,
  openPageEditor,
  pmDoc,
  pmParagraph,
  typeSlashQueryAtDocEnd,
} from './util';

test.describe('item #76 — slash dialog cancel preserves typed text', () => {
  test('escaping the /footnote dialog leaves the typed query intact', async ({ page, seeded }) => {
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

    // The typed query is preserved in its own paragraph (no consumed range)…
    await expect(editor.locator('p', { hasText: '/footnote' })).toHaveText('/footnote');
    // …and the previous block is untouched (no leak into the anchor).
    await expect(editor.locator('p', { hasText: anchor })).toHaveText(anchor);
    // No footnote mark was inserted by the cancelled dialog (the mark renders
    // as <sup data-footnote-id> — src/components/editor/blocks/footnote-mark.ts).
    await expect(editor.locator('sup[data-footnote-id]')).toHaveCount(0);
  });
});
