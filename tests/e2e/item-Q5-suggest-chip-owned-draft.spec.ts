// v0.10.3 Q-5 — the "Suggest edits" chip used to render on every editable page,
// including a private draft you own, where proposing tracked changes to yourself
// is noise. It should be hidden when the current user owns the page AND it is
// still a `draft`, and reappear once the page leaves draft.
//
// Behavior under guard: page.tsx computes `shouldShowSuggestEdits({isOwner,
// status})` and passes it to <Editor>, which gates the SuggestionToolbar
// (data-testid="suggest-toggle-chip") on it (src/components/editor/editor.tsx).
//
// RED on main: the chip is unconditionally mounted for editors, so it IS visible
// on a freshly-created owned draft. GREEN on this branch: hidden.
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor, pmDoc, pmParagraph } from './util';

test.describe('item Q-5 — Suggest-edits chip hidden on an owned draft', () => {
  test('a freshly-created draft you own is editable but shows no Suggest-edits chip', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);
    const sentinel = `q5draft${stamp}`;
    // POST /api/pages creates a Draft owned by the signed-in user.
    const pageId = await createPageViaApi(
      page,
      `Q5 owned draft ${stamp}`,
      pmDoc(pmParagraph(sentinel)),
    );

    const editor = await openPageEditor(page, pageId, sentinel);
    // The surface is editable (so on main the chip WOULD render) …
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    // … but the owned-draft guard suppresses the Suggest-edits chip.
    await expect(page.getByTestId('suggest-toggle-chip')).toHaveCount(0);
  });
});
