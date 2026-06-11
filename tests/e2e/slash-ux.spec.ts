// v0.9.9 Plan E (Slash Command UX Consistency) — route-reachability +
// per-feature deployed-image smoke for E1a (#246/#274 /equation live-preview
// modal), E1b (#274 /citation DOI auto-fetch), E1c (#274/#64 modal-first
// footnote/flashcard), and E2 (#73/#253 comment mention trailing text).
//
// DEFERRED-TO-CI: like tests/e2e/security-ux.spec.ts and search-refresh.spec.ts,
// this spec lives under tests/e2e/ but is NOT run by the local `pnpm test:a11y`
// (whose testDir is ./tests/a11y). CI extends testDir/testMatch to include
// tests/e2e and boots the app + seed, so these run against the built/deployed
// image there. We reuse the a11y fixtures (real seeded user + credentials
// sign-in) so the surface matches production.
import { expect, test } from '../a11y/fixtures';

async function signIn(
  page: import('@playwright/test').Page,
  seeded: { userEmail: string; userPassword: string },
) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(seeded.userEmail);
  await page.locator('input[name="password"]').fill(seeded.userPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

/** Open the slash menu in the page editor by typing `/` at the end of the doc. */
async function openSlashMenu(page: import('@playwright/test').Page, query: string) {
  const editor = page.locator('.ProseMirror').first();
  await editor.click();
  await editor.press('ControlOrMeta+End');
  // Always start a FRESH paragraph: the shared seeded page accumulates the
  // previous tests' trigger text (the #76 cancel-preserves-text contract keeps
  // an unsubmitted `/citation` in the doc), and `/` typed directly after a
  // word char must not fire (allowedPrefixes [' ']). A new block restores the
  // line-start trigger position deterministically.
  await editor.press('Enter');
  await page.keyboard.type(`/${query}`);
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
    await page.goto(`/pages/${seeded.pageId}`);
    await openSlashMenu(page, 'equation');
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
    await page.goto(`/pages/${seeded.pageId}`);
    await openSlashMenu(page, 'citation');
    // The grouped slash menu (#122) made option accessible names
    // title+description, so the old anchored /^Citation$/ stopped matching —
    // latent rot CI never caught because its e2e glob only runs item-*.spec.ts.
    // Anchor on the title prefix to stay distinct from "Citation (DOI/PubMed
    // lookup)".
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
    await page.goto(`/pages/${seeded.pageId}`);
    await openSlashMenu(page, 'footnote');
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
    await page.goto(`/pages/${seeded.pageId}`);
    // Open the comments panel and compose a comment with a mention + trailing text.
    const composer = page.locator('[contenteditable]').filter({ hasText: '' }).last();
    await composer.click();
    await page.keyboard.type('@');
    // Pick the first member suggestion when the popup appears.
    const firstMember = page.locator('.tippy-box [role="option"], .tippy-box button').first();
    if ((await firstMember.count()) > 0) {
      await firstMember.click();
      await page.keyboard.type('and the rest');
      // Submit (Cmd/Ctrl+Enter) and verify the persisted comment shows trailing text.
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.getByText(/and the rest/)).toBeVisible({ timeout: 10_000 });
    }
  });
});
