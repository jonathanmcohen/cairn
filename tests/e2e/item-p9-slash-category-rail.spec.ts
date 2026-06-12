// v0.10.2 item P9 — slash menu left-side category rail (jump-to navigation).
//
// Contract under test:
//  - (a) opening the slash menu with an EMPTY query shows a rail with exactly
//    the non-empty category groups in SLASH_CATEGORY_ORDER — and NO "Embed"
//    rail entry (premise pin: Embed is a MEDIA item, not a category);
//  - (b) clicking the LAST rail entry scrolls that group's header into the
//    listbox scroller's visible box (boundingBox math, not handler spies),
//    WITHOUT scrolling the page, and the flat keyboard index survives the
//    jump: ArrowDown + Enter still inserts a known item;
//  - (c) a narrowing query that leaves a single non-empty group hides the
//    rail (nothing to jump between) while options keep rendering.
//
// House pattern notes: the popup is `.tippy-box.cairn-slash-popup`; grouped
// option accessible names concatenate title + description, so options are
// matched by name REGEX (the slash-ux lesson). Hygiene for the persistent
// e2e dev DB: unique titles per run via stamp(); no waitForURL;
// scrollIntoViewIfNeeded only inside the popup. The seeded workspace may
// carry F2 custom slash commands from earlier runs, so the Workspace group
// is treated as optional throughout.
import { expect, signIn, test } from '../a11y/fixtures';
import {
  createPageViaApi,
  openPageEditor,
  pmDoc,
  pmParagraph,
  typeSlashQueryAtDocEnd,
} from './util';

type PwPage = import('@playwright/test').Page;

function stamp(): string {
  return `p9${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const POPUP = '.tippy-box.cairn-slash-popup';

/** Fresh page + open editor + type the slash query; returns popup + editor. */
async function openSlashMenuOnFreshPage(page: PwPage, s: string, query: string) {
  const sentinel = `P9 rail sentinel ${s}`;
  const pageId = await createPageViaApi(page, `P9 slash rail ${s}`, pmDoc(pmParagraph(sentinel)));
  const editor = await openPageEditor(page, pageId, sentinel);
  await typeSlashQueryAtDocEnd(page, editor, query);
  const popup = page.locator(POPUP);
  await expect(popup).toBeVisible({ timeout: 10_000 });
  return { popup, editor };
}

test.describe('item P9 — slash menu category rail', () => {
  test('(a) empty query shows the rail: non-empty groups in order, no Embed entry', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const { popup } = await openSlashMenuOnFreshPage(page, stamp(), '/');

    const rail = popup.getByTestId('slash-category-rail');
    await expect(rail).toBeVisible({ timeout: 10_000 });

    // Exactly the non-empty groups, in SLASH_CATEGORY_ORDER. The built-in
    // catalog always populates basic/media/database/advanced; 'Workspace'
    // appears only when the seeded workspace has F2 custom commands (the
    // persistent dev DB may or may not carry them) — accept both shapes.
    const labels = await rail.locator('button').allTextContents();
    const core = ['Basic', 'Media', 'Database', 'Advanced'];
    expect([JSON.stringify(core), JSON.stringify([...core, 'Workspace'])]).toContain(
      JSON.stringify(labels),
    );

    // Premise pin: Embed is a MEDIA item (an option in the listbox), never a
    // rail category.
    expect(labels).not.toContain('Embed');
    await expect(popup.getByRole('option', { name: /^Embed/i }).first()).toBeVisible();
  });

  test('(b) last rail entry jumps its header into the scroller; keyboard still inserts', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const { popup, editor } = await openSlashMenuOnFreshPage(page, stamp(), '/');

    const rail = popup.getByTestId('slash-category-rail');
    await expect(rail).toBeVisible({ timeout: 10_000 });

    // Last rail entry = Workspace if the seeded workspace has F2 commands,
    // else Advanced. Derive the matching header testid from the button's own
    // testid (slash-rail-<category> -> slash-group-header-<category>).
    const lastButton = rail.locator('button').last();
    const buttonTestId = await lastButton.getAttribute('data-testid');
    expect(buttonTestId).toMatch(/^slash-rail-(workspace|advanced)$/);
    const category = (buttonTestId as string).replace('slash-rail-', '');
    const header = popup.getByTestId(`slash-group-header-${category}`);
    const listbox = popup.getByRole('listbox');

    // Page-scroll guard: the jump must move the LISTBOX scroller, not the
    // document.
    const pageScrollBefore = await page.evaluate(() => window.scrollY);

    await lastButton.click();

    // The group header lands inside the scroller's VISIBLE box — assert via
    // boundingBox math (poll: the scroll is applied in a click handler).
    await expect
      .poll(
        async () => {
          const hb = await header.boundingBox();
          const sb = await listbox.boundingBox();
          if (!hb || !sb) return 'no-box';
          const inside = hb.y >= sb.y - 1 && hb.y + hb.height <= sb.y + sb.height + 1;
          return inside
            ? 'inside'
            : `header ${hb.y}..${hb.y + hb.height} vs scroller ${sb.y}..${sb.y + sb.height}`;
        },
        { timeout: 10_000 },
      )
      .toBe('inside');

    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);

    // Flat keyboard index unbroken after the mouse jump (the rail button
    // preventDefaults mousedown, so the editor keeps focus and the suggestion
    // keymap still receives keys). With an empty query the flat order starts
    // 'Heading 1', 'Heading 2' — ArrowDown + Enter inserts a level-2 heading.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(popup).toBeHidden({ timeout: 10_000 });
    await expect(editor.locator('h2')).toHaveCount(1, { timeout: 10_000 });
  });

  test('(c) narrowing to a single group hides the rail; options keep rendering', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // 'callout' matches only the basic-group Callout item (title match; no
    // other title/keyword contains it) — one non-empty group left.
    const { popup } = await openSlashMenuOnFreshPage(page, stamp(), '/callout');

    await expect(popup.getByRole('option', { name: /^Callout/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(popup.getByTestId('slash-category-rail')).toHaveCount(0);
  });
});
