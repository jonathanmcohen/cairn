// v0.9.18 Gate 3 — runtime spec for carry-forward item B5 (selecting a DEFERRED
// slash item that opens a modal must DISMISS the slash menu popup, not leave it
// mounted on top of the modal).
//
// Behavior under guard (src/components/editor/slash-extension.ts): DEFERRED
// items (citation/footnote/equation/flashcard…) dispatch NO ProseMirror
// transaction on select — the trigger range is consumed later, only when the
// dialog commits. So @tiptap/suggestion never transitions active→inactive and
// the popup's render().onExit (which destroys the tippy box) never fires; the
// `.tippy-box.cairn-slash-popup` lingered at z-9999 over the dialog overlay.
//
// The fix: `runSlashItem` tears the popup down for deferred items via the
// suggestion plugin's own exit meta (`exitSuggestion`) BEFORE the command opens
// the modal — same mechanism Escape-in-editor uses — WITHOUT consuming the
// trigger range. So the popup detaches, the modal is unobstructed, and a Cancel
// still finds the typed `/query` text to leave intact (item #76 stays green).
import { expect, signIn, test } from '../a11y/fixtures';
import {
  createPageViaApi,
  openPageEditor,
  pmDoc,
  pmParagraph,
  typeSlashQueryAtDocEnd,
} from './util';

test.describe('item B5 — deferred slash item dismisses the popup before its modal', () => {
  test('selecting /citation opens the dialog and tears down the slash popup', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const anchor = `itemB5 anchor ${stamp}`;
    const pageId = await createPageViaApi(
      page,
      `Item B5 slash dismiss ${stamp}`,
      pmDoc(pmParagraph(anchor)),
    );
    const editor = await openPageEditor(page, pageId, anchor);

    // New paragraph below the anchor, then type the slash query for a DEFERRED
    // modal item (Citation).
    await typeSlashQueryAtDocEnd(page, editor, '/citation');

    const popup = page.locator('.tippy-box.cairn-slash-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });

    // Select the Citation entry → deferred modal-first flow opens the dialog.
    // The option's accessible name is "<title> <description>" (the SlashMenu
    // renders both spans inside the role=option), so we disambiguate the manual
    // Citation item from "Citation (DOI/PubMed lookup)" by its unique
    // description text rather than an anchored title match.
    await page
      .getByRole('option')
      .filter({ hasText: 'Insert a bibliographic reference' })
      .first()
      .click();

    // The Citation dialog is up (its DOI field is a stable, unique label)…
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('DOI (optional)')).toBeVisible({ timeout: 10_000 });

    // …and the slash popup is NO LONGER showing over it. tippy's exit detaches
    // the box from the DOM (or, if still in the tree, drops data-state from
    // "visible"), so the bug (popup visible at z-9999 over the dialog) is gone.
    await expect(popup).toBeHidden({ timeout: 10_000 });
    // Belt-and-suspenders: it must not be a visible box parked over the dialog.
    await expect(page.locator('.tippy-box.cairn-slash-popup[data-state="visible"]')).toHaveCount(0);

    // Cancel with Escape (resolves null on the editor dialog bus) — the deferred
    // command never consumed the trigger range, so the typed text survives.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // #76 invariant carried here: the typed query is preserved in its own
    // paragraph (no consumed range, no lone "/")…
    await expect(editor.locator('p', { hasText: '/citation' })).toHaveText('/citation');
    // …and the previous block is untouched (no leak into the anchor).
    await expect(editor.locator('p', { hasText: anchor })).toHaveText(anchor);
    // No citation node was inserted by the cancelled dialog (the node renders
    // with data-citation-id — src/components/editor/extensions/citation.ts).
    await expect(editor.locator('[data-citation-id]')).toHaveCount(0);
  });
});
