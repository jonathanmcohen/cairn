// v0.9.18 Gate 3 — runtime spec for carry-forward item #53 (suggestions drawer
// renders the inline <del>/<ins> diff preview).
//
// Behavior under guard (src/components/editor/suggestions-drawer.tsx:49-75 +
// computeDiffPreview in src/lib/suggestions/diff-preview.ts): each open
// suggestion's card shows the suggestionDelete-marked text as a <del>
// (strikethrough, "Removed text") and the suggestionInsert-marked text as an
// <ins> ("Added text"), both computed from the live doc when the editor's
// mount-time GET /suggestions resolves.
//
// Full end-to-end drive: enable suggest mode (real POST), mark a selection as
// deleted and another as inserted (real suggestionDelete/suggestionInsert
// marks over the live Yjs doc), reload so the drawer list is fetched, open the
// drawer, and assert the card renders BOTH diff halves.
import { expect, signIn, test } from '../a11y/fixtures';
import { openSuggestionsDrawer, setupSuggestionWithDeleteMark } from './util';

test.describe('item #53 — suggest edits inline diff in the drawer', () => {
  test('the suggestion card renders <del> and <ins> diff halves', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const stamp = Date.now().toString(36);

    // Shared #53/#54 setup: page + suggest mode + suggestionDelete mark on the
    // single-word target paragraph, then reload with the suggestions GET
    // stalled until the doc has re-synced (so the diff sees the marks).
    // Before the reload inside the helper we ALSO mark an insert half below.
    const insertWord = `suggestwordins${stamp}`;
    const { targetWord } = await setupSuggestionWithDeleteMark(page, {
      stamp,
      fillerParagraphs: 2,
      extraInsertWord: insertWord,
    });

    const drawer = await openSuggestionsDrawer(page);

    // The card body renders the diff: <del> = removed text, <ins> = added text.
    const card = drawer.locator('li').first();
    await expect(card.getByText(/^by /)).toBeVisible();
    await expect(card.locator('del')).toHaveText(targetWord);
    await expect(card.locator('ins')).toHaveText(insertWord);
  });
});
