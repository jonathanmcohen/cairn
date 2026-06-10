// v0.9.18 Gate 3 — shared helpers for the per-item runtime specs.
//
// NOT a spec (testMatch is '**/*.spec.ts'); this module holds the small
// builders the item specs share so each spec stays focused on its assertion.
// All helpers run against the booted app via the page's own (cookie'd) request
// context — `signIn(page, seeded)` from tests/a11y/fixtures must have run
// first so `page.request` carries the session cookies.
import { expect, type Page } from '@playwright/test';

/** ProseMirror JSON paragraph node. */
export function pmParagraph(text: string): Record<string, unknown> {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

/** ProseMirror JSON heading node. */
export function pmHeading(level: number, text: string): Record<string, unknown> {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

/** ProseMirror JSON doc wrapper. */
export function pmDoc(...content: Record<string, unknown>[]): Record<string, unknown> {
  return { type: 'doc', content };
}

/**
 * Create a page through the real REST API (the same route the sidebar button
 * uses), then optionally PATCH its content. Returns the new page id. The
 * editor seeds its (empty) Y.Doc from `pages.content` on first provider sync,
 * so content planted here renders in the live collab editor on first open.
 */
export async function createPageViaApi(
  page: Page,
  title: string,
  content?: Record<string, unknown>,
): Promise<string> {
  const created = await page.request.post('/api/pages', { data: { title } });
  expect(created.ok(), `POST /api/pages failed: ${created.status()}`).toBe(true);
  const { id } = (await created.json()) as { id: string };
  if (content) {
    const patched = await page.request.patch(`/api/pages/${id}`, { data: { content } });
    expect(patched.ok(), `PATCH /api/pages/${id} failed: ${patched.status()}`).toBe(true);
  }
  return id;
}

/**
 * Open a page and wait until the live collab editor is actually usable:
 * ProseMirror mounted, the sentinel text (seeded via `createPageViaApi`)
 * rendered (which only happens after the Yjs provider sync seeds the doc),
 * and the collab status pill reporting "Live".
 */
export async function openPageEditor(page: Page, pageId: string, sentinelText: string) {
  await page.goto(`/pages/${pageId}`);
  const editor = page.locator('.ProseMirror').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor).toContainText(sentinelText, { timeout: 30_000 });
  // The connection-status chip carries title="Live" when connected (the bare
  // text also appears in the sr-only aria-live announcer, so target the chip).
  await expect(page.getByTitle('Live')).toBeVisible({ timeout: 30_000 });
  return editor;
}

/**
 * Type a slash query into a fresh paragraph at the END of the document.
 *
 * Caret placement is keyboard-only and platform-safe: macOS Chromium ignores
 * the End key in contenteditable (it scrolls without moving the caret) and
 * ProseMirror's base keymap binds neither Home nor End — so we select-all
 * (Mod-a, PM-bound on every platform) and collapse to the right edge with
 * ArrowRight, which lands the caret at the document end.
 *
 * The ArrowRight collapse is applied natively by the browser and only reaches
 * ProseMirror's state via its async `selectionchange` listener — a synthetic
 * Enter fired before that lands gets consumed against the stale selection and
 * silently does nothing. TipTap exposes the live Editor on the view DOM
 * element, so we poll the actual editor state for the collapsed caret at the
 * doc end before pressing Enter, then poll for the new paragraph before
 * typing.
 */
export async function typeSlashQueryAtDocEnd(
  page: Page,
  editor: ReturnType<Page['locator']>,
  query: string,
): Promise<void> {
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type EditorEl = Element & {
            editor?: {
              state: {
                selection: { empty: boolean; from: number };
                doc: { content: { size: number } };
              };
            };
          };
          const ed = (document.querySelector('.ProseMirror') as EditorEl | null)?.editor;
          if (!ed) return false;
          const { selection, doc } = ed.state;
          return selection.empty && selection.from >= doc.content.size - 1;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
  const paragraphsBefore = await editor.locator('p').count();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => editor.locator('p').count(), { timeout: 10_000 })
    .toBeGreaterThan(paragraphsBefore);
  await page.keyboard.type(query);
}

/**
 * Items #53/#54 shared setup — drive the real suggest-edits flow:
 *   1. create a page whose LAST paragraph is a single marked-target word
 *      (single word ⇒ a dblclick anywhere in the paragraph selects exactly it),
 *   2. select that word, enable suggest mode (which POSTs the open suggestion),
 *   3. "Mark delete" the selection (suggestionDelete mark, renders <del>),
 *      and — when `extraInsertWord` is given — "Mark insert" a second
 *      single-word paragraph (suggestionInsert mark, renders <ins>),
 *   4. reload so the mount-time GET /suggestions drives the drawer list, with
 *      the GET stalled until the editor has re-synced the marked text — the
 *      drawer's diff preview is computed from the live doc when that fetch
 *      resolves, so without the stall the diff could be computed against a
 *      not-yet-synced (empty) doc.
 * Returns the page id + the delete-marked word.
 */
export async function setupSuggestionWithDeleteMark(
  page: Page,
  opts: { stamp: string; fillerParagraphs: number; extraInsertWord?: string },
): Promise<{ pageId: string; targetWord: string }> {
  const { stamp, fillerParagraphs, extraInsertWord } = opts;
  const targetWord = `suggestworddel${stamp}`;
  const filler = Array.from({ length: fillerParagraphs }, (_, i) =>
    pmParagraph(`Filler paragraph ${i + 1} for item 53/54 scroll runway (${stamp}).`),
  );
  const pageId = await createPageViaApi(
    page,
    `Item 53-54 suggest ${stamp}`,
    pmDoc(
      pmParagraph(`Suggest spec anchor ${stamp}`),
      ...filler,
      ...(extraInsertWord ? [pmParagraph(extraInsertWord)] : []),
      pmParagraph(targetWord),
    ),
  );
  const editor = await openPageEditor(page, pageId, targetWord);

  // Select the target word FIRST (the toolbar computes the Mark buttons'
  // disabled state from editor.state.selection at render time, and the editor
  // host does not re-render on bare selection changes — toggling suggest mode
  // AFTER selecting renders the buttons already enabled). Dblclick near the
  // line start: the <p> is full-width, so its CENTER is empty space past the
  // single word and a centered dblclick selects nothing.
  await editor.locator('p', { hasText: targetWord }).dblclick({ position: { x: 10, y: 10 } });

  const toggle = page.getByTestId('suggest-toggle-chip');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

  const markDelete = page.getByRole('button', { name: 'Mark selection as deleted' });
  await expect(markDelete).toBeEnabled({ timeout: 15_000 });
  await markDelete.click();

  // The suggestionDelete mark renders as <del data-suggestion-id> in the doc.
  const delMark = editor.locator('del[data-suggestion-id]', { hasText: targetWord });
  await expect(delMark).toBeVisible({ timeout: 15_000 });

  if (extraInsertWord) {
    // Second half of the diff: select the insert-word paragraph and mark it as
    // inserted (suggestionInsert renders as <ins data-suggestion-id>). The
    // marking transaction above re-rendered the toolbar, so the Mark insert
    // button re-evaluates its disabled state after this selection change.
    await editor
      .locator('p', { hasText: extraInsertWord })
      .dblclick({ position: { x: 10, y: 10 } });
    const markInsert = page.getByRole('button', { name: 'Mark selection as inserted' });
    await expect(markInsert).toBeEnabled({ timeout: 15_000 });
    await markInsert.click();
    await expect(
      editor.locator('ins[data-suggestion-id]', { hasText: extraInsertWord }),
    ).toBeVisible({ timeout: 15_000 });
  }

  // Reload: the editor's mount effect GETs /suggestions and computes each
  // card's diff from the live doc at response time. Stall that GET until the
  // re-synced doc shows the mark so the diff computation can see it.
  await page.route(`**/api/pages/${pageId}/suggestions`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await page
      .locator('.ProseMirror del[data-suggestion-id]')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    await route.continue();
  });
  await page.reload();
  await expect(page.locator('.ProseMirror').first()).toContainText(targetWord, {
    timeout: 30_000,
  });

  return { pageId, targetWord };
}

/** Open the suggestions drawer via the "N open" toolbar chip. */
export async function openSuggestionsDrawer(page: Page) {
  const openChip = page.getByRole('button', { name: /open suggestion/ });
  await expect(openChip).toBeVisible({ timeout: 15_000 });
  await openChip.click();
  const drawer = page.getByRole('dialog', { name: 'Open suggestions' });
  await expect(drawer).toBeVisible({ timeout: 15_000 });
  return drawer;
}
