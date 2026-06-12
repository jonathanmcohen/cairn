// v0.10.2 item P1 — page-header de-clutter: Lock, Move-To and Bibliography
// leave the page toolbar for the "…" page menu (PageMenu).
//
// Asserted by SIDE EFFECT, not by implementation detail:
//  - (a) the toolbar row no longer contains the three relocated controls, and
//    all three are reachable from the page menu instead;
//  - (b) Lock via the menu actually locks (lock badge renders, the editor
//    surface stops being contenteditable) and Unlock via the menu restores;
//  - (c) "Move to…" opens the shared MoveToPicker and a real move reparents
//    the page — the sidebar tree re-renders the page nested under its new
//    parent (data-depth=1) and GET /api/pages/tree reports the new parentId;
//  - (d) Bibliography toggles the in-editor References section — proving the
//    `cairn:bibliography:toggle` CustomEvent crosses the server-menu/client-
//    editor boundary — and no-ops while the page is locked (D3/#188);
//  - (e) a viewer-role user sees neither Lock nor Move in the menu.
//
// Determinism notes (persistent e2e dev DB): every test creates its own pages
// with a unique stamp and deletes them (plus their audit rows) in finally —
// the item-E4/E6 cleanup recipe. Menu/submenu clicks scrollIntoViewIfNeeded
// first (long menus must never be clicked off-screen), and the sidebar lookup
// scrolls the virtualized tree because new pages sort to the bottom
// (createdAt asc).
import postgres from 'postgres';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';
import { createPageViaApi, openPageEditor, pmDoc, pmParagraph } from './util';

type PwPage = import('@playwright/test').Page;

function stamp(): string {
  return `p1${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupPages(pageIds: (string | null)[]): Promise<void> {
  const ids = pageIds.filter((id): id is string => id != null);
  if (ids.length === 0) return;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  const sql = postgres(url, { max: 1 });
  try {
    // Children first: a moved page references its parent via parent_id.
    for (const pageId of ids) {
      await sql`delete from audit_log where target_id = ${pageId}::uuid`;
      await sql`delete from pages where id = ${pageId}::uuid`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** ProseMirror JSON citation node (P18 schema) so the References section renders. */
function pmCitation(id: string, text: string): Record<string, unknown> {
  return {
    type: 'citation',
    attrs: {
      id,
      doi: null,
      pubmed_id: null,
      formatted_apa: text,
      formatted_mla: text,
      formatted_chicago: text,
      raw_authors: ['Doe, J.'],
      raw_title: text,
      raw_year: 2026,
    },
  };
}

/** Open the "…" page menu and return its dialog surface. */
async function openPageMenu(page: PwPage) {
  const trigger = page.getByRole('button', { name: 'Page menu' });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Page actions' });
  await expect(menu).toBeVisible();
  return menu;
}

/** Click a page-menu item, scrolling it into view first (the menu is long). */
async function clickMenuItem(menu: ReturnType<PwPage['locator']>, name: string) {
  const item = menu.getByRole('button', { name });
  await item.scrollIntoViewIfNeeded();
  await item.click();
}

/**
 * Find a sidebar tree row by title. The tree is virtualized AND ordered by
 * createdAt asc, so a freshly created page can be below the rendered window on
 * a long-lived dev DB — step the tree's scroll container until the row mounts.
 */
async function findTreeRow(page: PwPage, title: string) {
  // Wait for the virtualized tree to mount at least one row — right after a
  // reload/refresh the scroll-container lookup below would otherwise resolve
  // null, read as "at bottom", and bail before ever scrolling.
  await page
    .locator('[data-cairn-workspace-sidebar] li[data-row-kind]')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });
  const row = page.locator('li[data-row-kind="page"]').filter({ hasText: title }).first();
  // The tree orders by createdAt asc, so per-run pages live at the BOTTOM of a
  // long-lived dev DB (hundreds of rows — viewport-stepping from the top can't
  // cover it). Jump to the bottom first, then scan upward one viewport at a
  // time until the row mounts.
  for (let i = 0; i < 80; i++) {
    if ((await row.count()) > 0) {
      await row.scrollIntoViewIfNeeded();
      return row;
    }
    const atTop = await page.evaluate((iteration) => {
      // The sidebar holds two .cairn-thin-scrollbar containers (pinned section
      // + page tree); resolve the TREE's by walking up from a rendered row.
      const el = document
        .querySelector('[data-cairn-workspace-sidebar] li[data-row-kind]')
        ?.closest('.cairn-thin-scrollbar') as HTMLElement | null;
      if (!el) return false; // not mounted yet — keep waiting
      if (iteration === 0) {
        el.scrollTop = el.scrollHeight;
        return false;
      }
      const before = el.scrollTop;
      el.scrollTop = Math.max(0, before - el.clientHeight);
      return before === 0;
    }, i);
    if (atTop) break;
    await page.waitForTimeout(120);
  }
  return row;
}

test.describe('item P1 — Lock / Move / Bibliography live in the page menu', () => {
  test('(a) the toolbar no longer hosts the three controls; the menu does', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      const s = stamp();
      const sentinel = `Overflow seed ${s}`;
      pageId = await createPageViaApi(page, `P1 overflow ${s}`, pmDoc(pmParagraph(sentinel)));
      await openPageEditor(page, pageId, sentinel);

      const bar = page.getByTestId('page-toolbar');
      await expect(bar).toHaveCount(1);
      // With the menu CLOSED (its popover renders inside the bar), none of the
      // relocated controls remain anywhere in the toolbar row.
      await expect(bar.getByRole('button', { name: 'Lock page' })).toHaveCount(0);
      await expect(bar.getByRole('button', { name: 'Move to…' })).toHaveCount(0);
      await expect(bar.getByRole('button', { name: 'Bibliography' })).toHaveCount(0);
      // Untouched neighbours stay where they were (scope sanity).
      await expect(bar.getByRole('button', { name: 'Change status' })).toBeVisible();

      // …and all three are reachable from the "…" menu instead.
      const menu = await openPageMenu(page);
      await expect(menu.getByRole('button', { name: 'Lock page' })).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Move to…' })).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Bibliography' })).toBeVisible();
    } finally {
      await cleanupPages([pageId]);
    }
  });

  test('(b) Lock via the menu blocks editing; Unlock via the menu restores it', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      const s = stamp();
      const sentinel = `Lock seed ${s}`;
      pageId = await createPageViaApi(page, `P1 lock ${s}`, pmDoc(pmParagraph(sentinel)));
      await openPageEditor(page, pageId, sentinel);
      const editorSurface = page.locator('.ProseMirror').first();
      await expect(editorSurface).toHaveAttribute('contenteditable', 'true');

      // Lock: menu → "Lock page" → inline duration options → indefinite.
      let menu = await openPageMenu(page);
      await clickMenuItem(menu, 'Lock page');
      const lockNow = menu.getByRole('menuitem', { name: 'Lock indefinitely' });
      await lockNow.scrollIntoViewIfNeeded();
      await lockNow.click();

      // Side effects (soft refresh — no navigation): the lock badge appears in
      // the toolbar and the editor surface stops being editable.
      const bar = page.getByTestId('page-toolbar');
      await expect(bar.getByRole('status').filter({ hasText: 'Locked' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(editorSurface).toHaveAttribute('contenteditable', 'false', {
        timeout: 15_000,
      });

      // Unlock: the menu now offers "Unlock page" instead of "Lock page".
      // PageMenu's locked prop is server-rendered; router.refresh() lands a
      // beat after the lock badge — close and reopen until the item flips.
      await expect(async () => {
        await page.keyboard.press('Escape');
        menu = await openPageMenu(page);
        await expect(menu.getByRole('button', { name: 'Unlock page' })).toBeVisible({
          timeout: 1_500,
        });
      }).toPass({ timeout: 30_000 });
      // exact: true — getByRole name is a substring match, and "Unlock page"
      // contains "Lock page".
      await expect(menu.getByRole('button', { name: 'Lock page', exact: true })).toHaveCount(0);
      await clickMenuItem(menu, 'Unlock page');
      await expect(editorSurface).toHaveAttribute('contenteditable', 'true', {
        timeout: 15_000,
      });
      await expect(bar.getByRole('status').filter({ hasText: 'Locked' })).toHaveCount(0);
    } finally {
      await cleanupPages([pageId]);
    }
  });

  test('(c) Move via the menu opens the picker and reparents in the tree', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let sourceId: string | null = null;
    let targetId: string | null = null;
    try {
      const s = stamp();
      const targetTitle = `P1 move target ${s}`;
      targetId = await createPageViaApi(page, targetTitle);
      const sentinel = `Move seed ${s}`;
      const sourceTitle = `P1 move source ${s}`;
      sourceId = await createPageViaApi(page, sourceTitle, pmDoc(pmParagraph(sentinel)));
      await openPageEditor(page, sourceId, sentinel);

      const menu = await openPageMenu(page);
      await clickMenuItem(menu, 'Move to…');
      const picker = page.getByRole('dialog', { name: 'Move page to…' });
      await expect(picker).toBeVisible();
      await picker.getByPlaceholder('Search pages…').fill(targetTitle);
      const destination = picker.getByRole('button', { name: targetTitle });
      await destination.scrollIntoViewIfNeeded();
      await destination.click();
      await expect(picker).toHaveCount(0);

      // Side effect 1: the tree data reparented (what the sidebar renders).
      await expect
        .poll(
          async () => {
            const res = await page.request.get('/api/pages/tree');
            if (!res.ok()) return null;
            const body = (await res.json()) as {
              nodes: { id: string; parentId: string | null }[];
            };
            return body.nodes.find((n) => n.id === sourceId)?.parentId ?? null;
          },
          { timeout: 15_000 },
        )
        .toBe(targetId);

      // Side effect 2: the sidebar tree renders the page nested (depth 1)
      // under the target. The tree renders all pages flattened (no per-node
      // collapse), but the post-move router.refresh() race makes the live DOM
      // timing-dependent — reload for a fresh server render, then assert.
      await page.reload();
      const row = await findTreeRow(page, sourceTitle);
      await expect(row).toHaveAttribute('data-depth', '1');
    } finally {
      // Child first: source now references target via parent_id.
      await cleanupPages([sourceId, targetId]);
    }
  });

  test('(d) Bibliography via the menu toggles the References section; no-ops under lock', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      const s = stamp();
      const sentinel = `Bib seed ${s}`;
      const citeText = `Doe (2026) P1 citation ${s}`;
      pageId = await createPageViaApi(
        page,
        `P1 bib ${s}`,
        pmDoc(pmParagraph(sentinel), pmCitation(`cit-${s}`, citeText)),
      );
      await openPageEditor(page, pageId, sentinel);

      const references = page.locator('ol[role="doc-bibliography"]');

      // The section reads editor.getJSON() and TipTap 3 does NOT re-render on
      // transactions, so initial visibility after the Yjs seed is timing-
      // dependent — the deterministic proof of the menu wiring is the toggle
      // CYCLE: each CustomEvent flips hook state, forcing a re-render.
      // Toggle OFF from the menu (persists disable_bibliography=true)…
      let menu = await openPageMenu(page);
      await clickMenuItem(menu, 'Bibliography');
      await expect(references).toHaveCount(0, { timeout: 15_000 });

      // …then back ON: the re-render mounts the section with the synced doc.
      menu = await openPageMenu(page);
      await clickMenuItem(menu, 'Bibliography');
      await expect(references).toBeVisible({ timeout: 15_000 });
      await expect(references).toContainText(citeText);

      // D3/#188 lock contract: while locked the menu item stays clickable but
      // the editor no-ops the event — the section stays put and the persisted
      // metadata is untouched.
      const locked = await page.request.post(`/api/pages/${pageId}/lock`, { data: {} });
      expect(locked.ok(), `POST /lock failed: ${locked.status()}`).toBe(true);
      await openPageEditor(page, pageId, sentinel);
      await expect(page.locator('.ProseMirror').first()).toHaveAttribute(
        'contenteditable',
        'false',
      );
      menu = await openPageMenu(page);
      await clickMenuItem(menu, 'Bibliography');
      await expect(references).toBeVisible();
      const meta = await page.request.get(`/api/pages/${pageId}`);
      expect(meta.ok()).toBe(true);
      const body = (await meta.json()) as {
        metadata?: { disable_bibliography?: boolean } | null;
      };
      expect(body.metadata?.disable_bibliography ?? false).toBe(false);
    } finally {
      await cleanupPages([pageId]);
    }
  });

  test('(e) viewer role: Lock and Move are absent from the menu', async ({
    page,
    browser,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    let viewerContext: import('@playwright/test').BrowserContext | null = null;
    try {
      const s = stamp();
      const sentinel = `Viewer seed ${s}`;
      pageId = await createPageViaApi(page, `P1 viewer ${s}`, pmDoc(pmParagraph(sentinel)));

      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL required for the e2e harness');
      // A dedicated viewer-role member (the default second user is an editor).
      const viewer = await seedSecondUser(url, {
        workspaceId: seeded.workspaceId,
        email: 'p1-viewer@cairn.test',
        password: 'p1-viewer-password-1',
        role: 'viewer',
      });
      const second = await signInSecondUser(browser, {
        email: viewer.email,
        password: viewer.password,
      });
      viewerContext = second.context;
      const viewerPage = second.page;

      await viewerPage.goto(`/pages/${pageId}`);
      // Soft RSC navigation — assert the URL rather than waitForURL.
      await expect(viewerPage).toHaveURL(new RegExp(`/pages/${pageId}$`));
      await expect(viewerPage.locator('.ProseMirror').first()).toContainText(sentinel, {
        timeout: 30_000,
      });

      const menu = await openPageMenu(viewerPage);
      // Sanity: the menu rendered with its ungated items…
      await expect(menu.getByRole('button', { name: 'Copy link' })).toBeVisible();
      // …but the editor-gated Lock/Move items are absent for the viewer.
      await expect(menu.getByRole('button', { name: 'Lock page' })).toHaveCount(0);
      await expect(menu.getByRole('button', { name: 'Unlock page' })).toHaveCount(0);
      await expect(menu.getByRole('button', { name: 'Move to…' })).toHaveCount(0);
    } finally {
      await viewerContext?.close();
      await cleanupPages([pageId]);
    }
  });
});
