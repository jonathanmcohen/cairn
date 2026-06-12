// v0.10.2 P4 — lifecycle status pill color hierarchy.
//
// Behavior under guard: the StatusPicker pill (src/components/pages/
// status-picker.tsx) carries a semantic color pair per lifecycle status via
// the `--status-*-bg/fg` tokens in globals.css (light + dark values, surfaced
// as Tailwind utilities through the `@theme inline` `--color-status-*`
// mappings). This spec drives the REAL picker UI through the allowed
// transition walk draft → review → published → archived (the matrix in
// src/lib/pages/status-rules.ts forbids shortcuts; archived is reached from
// published, behind the v0.10.0 D5 confirm dialog) and asserts:
//   - every status renders a non-transparent computed background;
//   - each transition changes the computed background (4 distinct pairs);
//   - toggling `.dark` on <html> swaps the pair to the dark-mode values;
//   - the `data-status` attribute survives (item-37 guard).
import type { Locator, Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor, pmDoc, pmParagraph } from './util';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

async function pillColors(pill: Locator): Promise<{ bg: string; fg: string }> {
  return pill.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
}

/**
 * Drive one transition through the real popover menu and wait for the pill to
 * report the new status. `confirmLabel` clicks the themed confirm dialog's
 * action button (published → archived warns about the public link going dark).
 */
async function transitionTo(
  page: Page,
  pill: Locator,
  itemLabel: string,
  toStatus: string,
  confirmLabel?: string,
): Promise<void> {
  await pill.scrollIntoViewIfNeeded();
  await pill.click();
  const item = page.getByRole('menuitem', { name: itemLabel, exact: true });
  await item.scrollIntoViewIfNeeded();
  await item.click();
  if (confirmLabel) {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: confirmLabel, exact: true }).click();
  }
  await expect(pill).toHaveAttribute('data-status', toStatus);
}

test.describe('item P4 — status pill color hierarchy', () => {
  test('each lifecycle status renders a distinct themed color pair, light and dark', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const title = `P4 pill colors ${Date.now()}`;
    const pageId = await createPageViaApi(page, title, pmDoc(pmParagraph('P4 pill sentinel')));
    await openPageEditor(page, pageId, 'P4 pill sentinel');
    await expect(page).toHaveURL(new RegExp(`/pages/${pageId}`));

    // The editor-role trigger pill is the only [data-status] element on the page.
    const pill = page.getByRole('button', { name: 'Change status' });
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill).toHaveAttribute('data-status', 'draft');

    const seen: Record<string, { bg: string; fg: string }> = {};
    seen.draft = await pillColors(pill);
    expect(seen.draft.bg, 'draft pill must have a painted background').not.toBe(TRANSPARENT);
    expect(seen.draft.fg).not.toBe(TRANSPARENT);

    // The status-rules matrix only allows draft→review→published→archived in
    // this direction; walk it through the real UI and assert each step paints
    // a different background than the one before.
    const walk: Array<{ label: string; status: string; confirm?: string }> = [
      { label: 'In review', status: 'review' },
      { label: 'Published', status: 'published' },
      { label: 'Archived', status: 'archived', confirm: 'Archive' },
    ];
    let previous = seen.draft;
    for (const step of walk) {
      await transitionTo(page, pill, step.label, step.status, step.confirm);
      const colors = await pillColors(pill);
      expect(colors.bg, `${step.status} pill must have a painted background`).not.toBe(TRANSPARENT);
      expect(colors.fg).not.toBe(TRANSPARENT);
      expect(colors.bg, `${step.status} bg must differ from the previous status`).not.toBe(
        previous.bg,
      );
      seen[step.status] = colors;
      previous = colors;
    }

    // All four statuses paint pairwise-distinct backgrounds.
    const distinctBgs = new Set(Object.values(seen).map((c) => c.bg));
    expect(distinctBgs.size, 'all four statuses must have distinct backgrounds').toBe(4);

    // Dark mode: the tokens carry separate values under `.dark`, so flipping
    // the class on <html> must change the computed pair (no remount needed —
    // the custom properties cascade).
    const lightArchived = seen.archived;
    if (!lightArchived) throw new Error('archived colors were not recorded');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const darkArchived = await pillColors(pill);
    expect(darkArchived.bg, 'dark-mode bg must differ from light-mode bg').not.toBe(
      lightArchived.bg,
    );
    expect(darkArchived.fg, 'dark-mode fg must differ from light-mode fg').not.toBe(
      lightArchived.fg,
    );
    expect(darkArchived.bg).not.toBe(TRANSPARENT);

    // item-37 guard — the data-status attribute is still present after all of it.
    await expect(pill).toHaveAttribute('data-status', 'archived');
  });
});
