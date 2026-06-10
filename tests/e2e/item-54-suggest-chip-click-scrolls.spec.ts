// v0.9.18 Gate 3 — runtime spec for carry-forward item #54 (clicking a
// suggestion card scrolls the editor to the suggested range).
//
// Behavior under guard (#119, src/components/editor/suggestions-drawer.tsx:
// the card's content region is a single whole-chip <button> whose click
// invokes onView; editor.tsx#viewSuggestion scrolls the first
// [data-suggestion-id="<id>"] mark into view, moves the text selection to it,
// and closes the drawer).
//
// Setup mirrors item #53 (real suggest mode + suggestionDelete mark over the
// live Yjs doc), with enough filler paragraphs that the marked target sits far
// below the fold after reload — so the scroll effect is actually observable.
import { expect, signIn, test } from '../a11y/fixtures';
import { openSuggestionsDrawer, setupSuggestionWithDeleteMark } from './util';

test.describe('item #54 — suggestion chip click scrolls to the range', () => {
  test('clicking the card body scrolls the marked range into view and moves the selection', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);

    await setupSuggestionWithDeleteMark(page, { stamp, fillerParagraphs: 40 });

    // After the reload the viewport rests at the top; the marked target lives
    // below 40 filler paragraphs, so it must start OUTSIDE the viewport.
    const delMark = page.locator('.ProseMirror del[data-suggestion-id]').first();
    await expect(delMark).not.toBeInViewport();

    // Sanity: no DOM selection inside the target block before the click.
    const selectionInTargetBefore = await page.evaluate(() => {
      const sel = window.getSelection();
      const node = sel?.anchorNode ?? null;
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      if (!el) return false;
      if (el.closest('del[data-suggestion-id]')) return true;
      const block = el.closest('.ProseMirror p, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3');
      return Boolean(block?.querySelector('del[data-suggestion-id]'));
    });
    expect(selectionInTargetBefore).toBe(false);

    const drawer = await openSuggestionsDrawer(page);

    // #119 — the whole card body (author line + diff preview) is one button;
    // clicking it (NOT the "View in document" action) invokes onView.
    const cardBody = drawer.locator('li button').first();
    await expect(cardBody).toContainText(/by /);
    await cardBody.click();

    // onView closes the drawer so the document is visible…
    await expect(drawer).toBeHidden({ timeout: 10_000 });
    // …and scrolls the suggested range into the viewport (smooth scroll — the
    // assertion polls until the animation lands).
    await expect(delMark).toBeInViewport({ timeout: 10_000 });

    // The text selection moved to the suggested range: the DOM selection
    // anchor now sits inside the marked <del> (or at its block boundary).
    const selectionInTargetAfter = await page.evaluate(() => {
      const sel = window.getSelection();
      const node = sel?.anchorNode ?? null;
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      if (!el) return false;
      if (el.closest('del[data-suggestion-id]')) return true;
      const block = el.closest('.ProseMirror p, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3');
      return Boolean(block?.querySelector('del[data-suggestion-id]'));
    });
    expect(selectionInTargetAfter).toBe(true);
  });
});
