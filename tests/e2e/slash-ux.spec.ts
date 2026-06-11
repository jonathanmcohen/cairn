// v0.9.9 Plan E (Slash Command UX Consistency) — route-reachability +
// per-feature deployed-image smoke for E1a (#246/#274 /equation live-preview
// modal), E1b (#274 /citation DOI auto-fetch), E1c (#274/#64 modal-first
// footnote/flashcard), and E2 (#73/#253 comment mention trailing text).
//
// v0.10.0 H1 de-rot: every test now runs on a FRESH page created through the
// real API (tests/e2e/util.ts) instead of the shared seeded page. The dev DB
// persists across runs, so the shared doc accumulated each run's inserted
// equation/citation/footnote nodes until the doc-end caret position stopped
// being a usable slash-trigger spot (order-dependent menu-never-opens reds).
// Sign-in goes through the fixtures' worker-cached cookie jar — per-test
// credential form drives tripped the 5/min auth limiter across the suite.
import { expect, signIn, test } from '../a11y/fixtures';
import {
  createPageViaApi,
  openPageEditor,
  pmDoc,
  pmParagraph,
  typeSlashQueryAtDocEnd,
} from './util';

/** Create a fresh page with a sentinel, open its editor, type the query. */
async function openSlashMenuOnFreshPage(
  page: import('@playwright/test').Page,
  title: string,
  query: string,
) {
  const sentinel = `slash-ux ${title} ${Date.now().toString(36)}`;
  const pageId = await createPageViaApi(page, sentinel, pmDoc(pmParagraph(sentinel)));
  const editor = await openPageEditor(page, pageId, sentinel);
  await typeSlashQueryAtDocEnd(page, editor, `/${query}`);
}

test.describe('Plan E slash UX surfaces', () => {
  test('route-reachability — page editor loads its ProseMirror surface', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.goto(`/pages/${seeded.pageId}`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 30_000 });
  });

  test('#246/#274 — /equation opens a modal with a LaTeX field + live preview', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await openSlashMenuOnFreshPage(page, 'equation', 'equation');
    await page
      .getByRole('option', { name: /Equation/i })
      .first()
      .click();

    const latex = page.getByLabel('LaTeX');
    await expect(latex).toBeVisible({ timeout: 10_000 });
    await latex.fill('\\frac{1}{2}');
    // Live preview renders KaTeX markup (a .katex span), not raw text.
    await expect(page.getByTestId('equation-preview').locator('.katex')).toBeVisible();
    // Insert places a populated math node (no empty-node + extra click).
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByLabel('LaTeX')).toHaveCount(0);
  });

  test('#274 — /citation modal exposes a Fetch-from-DOI affordance', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await openSlashMenuOnFreshPage(page, 'citation', 'citation');
    // The grouped slash menu (#122) made option accessible names
    // title+description, so the old anchored /^Citation$/ stopped matching —
    // latent rot CI never caught while its e2e glob only ran item-*. Anchor on
    // the title prefix to stay distinct from "Citation (DOI/PubMed lookup)".
    await page
      .getByRole('option', { name: /^Citation Insert/i })
      .first()
      .click();

    await expect(page.getByLabel('DOI (optional)')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Fetch from DOI' })).toBeVisible();
  });

  test('#274/#64 — /footnote opens a single-field modal (no bare node)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await openSlashMenuOnFreshPage(page, 'footnote', 'footnote');
    await page
      .getByRole('option', { name: /Footnote/i })
      .first()
      .click();
    await expect(page.getByLabel('Footnote text')).toBeVisible({ timeout: 10_000 });
  });

  test('#73/#253 — comment composer keeps text typed after an @-mention pick', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const sentinel = `slash-ux mention ${Date.now().toString(36)}`;
    const pageId = await createPageViaApi(page, sentinel, pmDoc(pmParagraph(sentinel)));
    await openPageEditor(page, pageId, sentinel);
    // Open the comments panel and scope the composer to it — a bare
    // `[contenteditable]` could resolve to the page editor itself (which also
    // offers @-mentions), making the final assert order-dependent (H1 de-rot).
    await page
      .getByRole('button', { name: /comments/i })
      .first()
      .click();
    const panel = page.locator('aside').filter({ hasText: 'Comments' });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const composer = panel.locator('[contenteditable="true"]').first();
    await composer.click();
    await page.keyboard.type('@');
    // Pick the first member suggestion via MOUSE. No silent skip: the popup
    // MUST appear (the old `if (count > 0)` guard let the regression pass
    // unobserved). The mouse path is the regression surface: without the
    // mention list's mousedown preventDefault the click blurs the composer
    // and the trailing text goes nowhere (#73/#253).
    const firstMember = page.locator('.tippy-box [role="option"], .tippy-box button').first();
    await expect(firstMember).toBeVisible({ timeout: 10_000 });
    await firstMember.click();
    const trailing = `and the rest ${Date.now().toString(36)}`;
    await page.keyboard.type(trailing);
    await panel.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(panel.getByText(trailing)).toBeVisible({ timeout: 10_000 });
  });
});
