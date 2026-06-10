// v0.9.19 C3 (#53/#54) — TWO-USER runtime regression lock for suggest-edits.
//
// #53 (inline <del>/<ins> diff) and #54 (whole-chip click scrolls to + selects
// the suggested range) already ship and have SINGLE-user guards
// (item-53-*.spec, item-54-*.spec). But suggestions are a two-actor feature:
// one user authors a suggestion, a DIFFERENT user reviews the diff, jumps to
// the range, and accepts. This spec exercises that across two distinct accounts
// in two browser contexts over the LIVE Yjs/Hocuspocus collab server, so the
// cross-account path (visibility + accept round-trip) is covered, not just the
// single-editor case.
//
// Guard (the feature already shipped) — no "before". Falsifiability is proven
// the C2 way: locally break the accept's Yjs mirror (editor.tsx resolve()) so
// an accept no longer propagates to the other client, and watch the User-A
// assertions go red (recorded in the PR).
//
// Requires `pnpm test:e2e` (playwright.e2e.config.ts), which boots the real
// Hocuspocus collab server on :11334 so the two contexts actually sync.
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';
import { openPageEditor, openSuggestionsDrawer, setupSuggestionWithDeleteMark } from './util';

test.describe('items #53/#54 — suggest-edits across two user accounts', () => {
  test('a second account sees the diff, jumps to the range, and accepts over live Yjs', async ({
    page,
    seeded,
    browser,
  }) => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL required for the two-user suggest-edits spec');

    // User B: an editor member of the seeded workspace (editor can resolve
    // suggestions; a viewer would 403). Sign A into the default context and B
    // into its own context.
    const second = await seedSecondUser(dbUrl, { workspaceId: seeded.workspaceId, role: 'editor' });
    await signIn(page, seeded);
    const b = await signInSecondUser(browser, second);

    try {
      const stamp = Date.now().toString(36);
      const insertWord = `suggestwordins${stamp}`;

      // 1. User A authors a suggestion (delete half + insert half, one
      //    suggestion) over the live Yjs doc. The helper persists it (reload +
      //    stalled GET) so B's mount-time fetch returns it, and plants 40 filler
      //    paragraphs so the marked range sits below the fold for the #54 scroll.
      const { pageId, targetWord } = await setupSuggestionWithDeleteMark(page, {
        stamp,
        fillerParagraphs: 40,
        extraInsertWord: insertWord,
      });

      // 2. User B opens the SAME page in their own context. Stall B's mount-time
      //    GET /suggestions until B's editor has Yjs-synced BOTH marks, so the
      //    drawer's diff preview is computed against the populated doc (the
      //    diff is computed client-side from the live doc when that GET
      //    resolves — same race the single-user helper guards against).
      await b.page.route(`**/api/pages/${pageId}/suggestions`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        await b.page
          .locator('.ProseMirror del[data-suggestion-id]')
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        await b.page
          .locator('.ProseMirror ins[data-suggestion-id]')
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        await route.continue();
      });
      const bEditor = await openPageEditor(b.page, pageId, targetWord);

      // 3. #53 cross-account: B's drawer shows the suggestion card authored by A,
      //    with BOTH inline diff halves.
      const bDrawer = await openSuggestionsDrawer(b.page);
      const bCard = bDrawer.locator('li').first();
      await expect(bCard.getByText(/^by /)).toBeVisible();
      await expect(bCard.locator('del')).toHaveText(targetWord);
      await expect(bCard.locator('ins')).toHaveText(insertWord);

      // 4. #54 whole-chip click in B's context: the suggested range sits below
      //    the fold; clicking the card BODY (not "View in document") closes the
      //    drawer and scrolls the range into B's viewport. viewSuggestion scrolls
      //    to the suggestion's FIRST mark (here the <ins> half, which precedes
      //    the <del> half in document order), so assert on that range mark.
      const bRangeMark = b.page.locator('.ProseMirror [data-suggestion-id]').first();
      await expect(bRangeMark).not.toBeInViewport();
      const cardBody = bDrawer.locator('li button').first();
      await expect(cardBody).toContainText(/by /);
      await cardBody.click();
      await expect(bDrawer).toBeHidden({ timeout: 10_000 });
      await expect(bRangeMark).toBeInViewport({ timeout: 10_000 });

      // 5. Accept over live Yjs: B reopens the drawer and accepts. resolve()
      //    POSTs the accept AND mirrors the transform onto the shared Y.Doc,
      //    which syncs to A. Scope the Accept to the dialog so it can't resolve
      //    to the toolbar's identically-named selection-targeted Accept.
      const bDrawer2 = await openSuggestionsDrawer(b.page);
      await bDrawer2.getByRole('button', { name: 'Accept' }).click();

      // B's own doc converges: the suggestion marks are gone, the deleted word
      // is removed, the inserted word is kept.
      await expect(b.page.locator('.ProseMirror del[data-suggestion-id]')).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(bEditor).not.toContainText(targetWord, { timeout: 15_000 });
      await expect(bEditor).toContainText(insertWord);

      // User A's editor (the OTHER context, never reloaded) receives the accept
      // over Yjs: its marks vanish and the delete is applied there too. This is
      // the cross-account round-trip the single-user guards can't cover.
      const aEditor = page.locator('.ProseMirror').first();
      await expect(page.locator('.ProseMirror del[data-suggestion-id]')).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(aEditor).not.toContainText(targetWord, { timeout: 15_000 });
      await expect(aEditor).toContainText(insertWord);
    } finally {
      await b.context.close();
    }
  });
});
