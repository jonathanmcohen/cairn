// v0.9.9 Plan T (Comments) — route-reachability + per-feature deployed-image
// smoke for T1 (#74/#255): inline edit affordance on the author's own comment.
//
// DEFERRED-TO-CI: like tests/e2e/empty-states-nav.spec.ts, this spec lives under
// tests/e2e/ but is NOT run by the local `pnpm test:a11y` (whose testDir is
// ./tests/a11y). CI extends testDir/testMatch to include tests/e2e, boots the
// built/deployed image + seed, and runs these against production-identical
// surfaces. Reuses the a11y fixtures (real seeded user + credentials sign-in).
import { expect, signIn, test } from '../a11y/fixtures';

// Open the first seeded page and reveal its comment panel. The panel is the
// `aside` rendered by CommentPanel; the trigger is the comments toggle in the
// page action bar.
async function openFirstPageComments(page: import('@playwright/test').Page) {
  // H1 de-rot: create a fresh page through the real API instead of clicking
  // the first sidebar tree link. The helper's job is to REACH a page; at
  // accumulated-page scale the virtualized tree re-measures continuously and
  // the row click sat on "element is not stable" for the full timeout (tree
  // interaction itself is covered elsewhere; churn noted for H3/H4).
  const created = await page.request.post('/api/pages', {
    data: { title: `comment-edit ${Date.now().toString(36)}` },
  });
  if (!created.ok()) throw new Error(`POST /api/pages failed: ${created.status()}`);
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/pages/${id}`);
  // Toggle the comments panel open.
  await page
    .getByRole('button', { name: /comments/i })
    .first()
    .click();
}

test.describe('Plan T — comment edit affordance (#74/#255)', () => {
  test('comment panel renders as an aside', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await openFirstPageComments(page);
    // Scope past the workspace sidebar (also an <aside> since the C1 sticky
    // shell) — the comments panel is the aside that carries the Comments copy.
    await expect(page.locator('aside').filter({ hasText: 'Comments' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('author edits own comment inline and sees the (edited) marker', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await openFirstPageComments(page);

    // Add a comment as the author so we have one we are allowed to edit.
    // Unique per-run body: the dev DB persists across runs, so a fixed string
    // accumulates duplicates and trips Playwright strict mode.
    const stamp = Date.now().toString(36);
    const original = `typpo comment ${stamp}`;
    const fixed = `typo fixed ${stamp}`;
    const composer = page.locator('aside [contenteditable="true"]').first();
    await composer.click();
    await composer.type(original);
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByText(original)).toBeVisible({ timeout: 15_000 });

    // The author sees the Edit pencil on OUR comment; scope to its list item
    // (older comments from prior runs may carry Edit buttons too). The
    // text-filtered locator goes STALE once editing starts — the paragraph is
    // replaced by a textarea holding the new text — so the edit-mode controls
    // are scoped to the panel instead (only one comment edits at a time).
    const panel = page.locator('aside').filter({ hasText: 'Comments' });
    await page
      .getByRole('listitem')
      .filter({ hasText: original })
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    const editor = panel.locator('textarea').first();
    await editor.fill(fixed);
    await panel.getByRole('button', { name: 'Save', exact: true }).click();

    const editedItem = page.getByRole('listitem').filter({ hasText: fixed });
    await expect(editedItem).toBeVisible({ timeout: 15_000 });
    await expect(editedItem.getByText('(edited)')).toBeVisible();
  });
});
