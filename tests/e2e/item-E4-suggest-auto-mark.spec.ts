// v0.10.0 Plan E E4 — suggest-mode auto-mark-on-type (live-deploy sweep
// v0.9.19 follow-up).
//
// Suggest mode used to be entirely manual: toggle Suggesting, select a range,
// click "Mark insert"/"Mark delete". The sweep expected Google-Docs-style
// auto-tracking. E4 adds it (the manual buttons stay): while Suggesting is ON,
// typed text gains the suggestionInsert mark (renders <ins data-suggestion-id>)
// and deletions become suggestionDelete tombstones (<del data-suggestion-id>,
// text kept). The rewrite lives in the SuggestionAutoMark ProseMirror plugin
// (src/components/editor/suggestion-auto-mark.ts) and runs through the normal
// transaction pipeline, so it replicates over the live Yjs/Hocuspocus collab
// server like hand-typed content.
//
// RED on the old build:
//  - (a) typing in suggest mode produced UNMARKED plain text — no <ins> ever
//    appears, so the falsifiable-core locator times out;
//  - (b) Backspace really deleted the word (no <del>, text gone);
//  - (c) the peer saw plain unmarked text;
//  - (e) there was nothing to accept (typing created no marks).
//
// Determinism notes (persistent e2e dev DB): each test creates its own page
// via /api/pages with a unique stamp, seeds the exact doc directly in the DB
// (pages.content + page_yjs — the item-E3/item-117 recipe, so the editor
// renders the seeded Yjs state on connect), waits for the seeded text + the
// "Live" collab pill BEFORE typing (typing immediately after load races the
// collab connect — the E3 lesson), and deletes the page (cascades page_yjs +
// suggestions; audit_log rows separately) in finally.
import { getSchema } from '@tiptap/core';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { schemaExtensions } from '@/components/editor/schema';
import * as schema from '@/db/schema';
import { updatePage } from '@/lib/pages/update';
import { expect, signIn, test } from '../a11y/fixtures';
import { pmDoc, pmParagraph } from './util';

type PwPage = import('@playwright/test').Page;
type PwLocator = import('@playwright/test').Locator;

function stamp(): string {
  return `e4${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  const sql = postgres(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cleanupPage(pageId: string | null): Promise<void> {
  if (!pageId) return;
  await withSql(async (sql) => {
    await sql`delete from audit_log where target_id = ${pageId}::uuid`;
    await sql`delete from pages where id = ${pageId}::uuid`;
  });
}

async function createPageViaApi(page: PwPage, title: string): Promise<string> {
  const res = await page.request.post('/api/pages', { data: { title } });
  expect(res.status(), await res.text().catch(() => '')).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/**
 * Seed the page document directly in the DB (both `pages.content` and the
 * Hocuspocus-persisted `page_yjs.state`) — the item-E3 deterministic recipe.
 * The editor renders from the pre-seeded Yjs state on connect, so the doc is
 * exact (no input-rule typing involved in the setup).
 */
async function seedDoc(args: {
  pageId: string;
  workspaceId: string;
  userEmail: string;
  doc: Record<string, unknown>;
}): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the item-E4 seed');
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
  try {
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, args.userEmail))
      .limit(1);
    if (!user) throw new Error('seeded a11y user not found');

    await updatePage(db, {
      pageId: args.pageId,
      workspaceId: args.workspaceId,
      byUserId: user.id,
      adminOverride: true,
      patch: { content: args.doc },
    });

    const pmSchema = getSchema(schemaExtensions());
    const ydoc = prosemirrorJSONToYDoc(pmSchema, args.doc, 'default');
    const state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    await db
      .insert(schema.pageYjs)
      .values({ pageId: args.pageId, state })
      .onConflictDoUpdate({
        target: schema.pageYjs.pageId,
        set: { state, updatedAt: new Date() },
      });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Create + seed a fresh page and open it. Waits for the seeded sentinel text
 * AND the "Live" collab pill — the readiness signal that typing is safe (the
 * E3 lesson: typing immediately after load races the collab connect).
 */
async function openSeededPage(
  page: PwPage,
  seeded: { workspaceId: string; userEmail: string },
  args: { title: string; doc: Record<string, unknown>; sentinel: string },
): Promise<string> {
  const pageId = await createPageViaApi(page, args.title);
  await seedDoc({
    pageId,
    workspaceId: seeded.workspaceId,
    userEmail: seeded.userEmail,
    doc: args.doc,
  });
  await openExistingPage(page, pageId, args.sentinel);
  return pageId;
}

/** Open an ALREADY seeded page (second client) with the same readiness gate. */
async function openExistingPage(page: PwPage, pageId: string, sentinel: string): Promise<void> {
  await page.goto(`/pages/${pageId}`);
  const editor = page.locator('.ProseMirror').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor).toContainText(sentinel, { timeout: 30_000 });
  // v0.10.2 S14 added a second "Live" chip in the sidebar footer; scope to the
  // page-header toolbar so this stays a single-element match.
  await expect(page.getByTestId('page-toolbar').getByTitle('Live')).toBeVisible({
    timeout: 30_000,
  });
}

/** Toggle Suggesting ON via the toolbar chip and wait for the active state
 *  (aria-pressed flips only AFTER the open-suggestion POST resolves, so the
 *  active suggestion id is plumbed into the auto-mark plugin by then). */
async function enableSuggesting(page: PwPage): Promise<void> {
  const toggle = page.getByTestId('suggest-toggle-chip');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
}

/**
 * Keyboard-only caret placement at the document END (macOS Chromium ignores
 * End in contenteditable): focus the editor, select-all, collapse right, then
 * poll the live editor state for the collapsed doc-end caret — the ArrowRight
 * collapse reaches ProseMirror via its async selectionchange listener, so a
 * keystroke fired before that lands gets eaten (the util.ts pattern).
 */
async function placeCaretAtDocEnd(page: PwPage, editor: PwLocator): Promise<void> {
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
}

/**
 * Double-click-select a single-word paragraph and WAIT for the selection to
 * reach ProseMirror STATE. The dblclick word selection is performed natively
 * by the browser (ProseMirror handles double-click itself only via the
 * handleDoubleClick props — word selection it leaves to the default), so it
 * reaches ProseMirror's state through the same async `selectionchange`
 * listener as the ArrowRight collapse in placeCaretAtDocEnd — a synthetic
 * Backspace fired before that lands is consumed against the stale collapsed
 * selection and silently does nothing (doc untouched, no deletion transaction
 * for the auto-mark plugin to rewrite). Poll the live editor state until the
 * selection spans exactly the word before letting the caller type.
 */
async function selectWordByDblclick(page: PwPage, editor: PwLocator, word: string): Promise<void> {
  // Single-word paragraph: a dblclick near the line start selects exactly the
  // word (the <p> is full-width, so its center is empty space past the word —
  // util.ts pattern).
  await editor.locator('p', { hasText: word }).dblclick({ position: { x: 10, y: 10 } });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type EditorEl = Element & {
            editor?: {
              state: {
                selection: { empty: boolean; from: number; to: number };
                doc: { textBetween(from: number, to: number, blockSeparator?: string): string };
              };
            };
          };
          const ed = (document.querySelector('.ProseMirror') as EditorEl | null)?.editor;
          if (!ed) return '';
          const { selection, doc } = ed.state;
          if (selection.empty) return '';
          return doc.textBetween(selection.from, selection.to, ' ');
        }),
      { timeout: 10_000 },
    )
    .toBe(word);
}

test.describe('item E4 — suggest mode auto-marks typing and deletions', () => {
  test('(a) falsifiable core: typing while Suggesting renders suggestionInsert-marked text', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      const s = stamp();
      const sentinel = `Auto mark seed ${s}`;
      pageId = await openSeededPage(page, seeded, {
        title: `E4 auto-insert ${s}`,
        doc: pmDoc(pmParagraph(sentinel)),
        sentinel,
      });
      const editor = page.locator('.ProseMirror').first();

      await enableSuggesting(page);
      await placeCaretAtDocEnd(page, editor);
      const typed = `XYZ${s}`;
      await page.keyboard.type(typed);

      // THE RED ASSERTION on the old build: typing in suggest mode produced
      // UNMARKED text — no <ins data-suggestion-id> ever exists.
      const ins = editor.locator('ins[data-suggestion-id]', { hasText: typed });
      await expect(ins).toBeVisible({ timeout: 15_000 });
      // The auto-mark carries a real suggestion id (the open proposal created
      // by the toggle), not a placeholder.
      await expect(ins).toHaveAttribute('data-suggestion-id', /.+/);
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('(b) Backspace over a selection tombstones the text instead of removing it', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      const s = stamp();
      const word = `tombstone${s}`;
      const sentinel = `Delete seed ${s}`;
      pageId = await openSeededPage(page, seeded, {
        title: `E4 tombstone ${s}`,
        doc: pmDoc(pmParagraph(sentinel), pmParagraph(word)),
        sentinel: word,
      });
      const editor = page.locator('.ProseMirror').first();

      await enableSuggesting(page);
      await selectWordByDblclick(page, editor, word);
      await page.keyboard.press('Backspace');

      // The word is STILL in the doc, struck through as a suggestionDelete
      // tombstone. On the old build it was really deleted.
      const del = editor.locator('del[data-suggestion-id]', { hasText: word });
      await expect(del).toBeVisible({ timeout: 15_000 });
      await expect(editor).toContainText(word);
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('(c) Yjs replication: a second client sees the auto-marked insert live', async ({
    page,
    seeded,
    browser,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    // Same user in a second tab/context (two distinct collab clients over ws).
    const contextB = await browser.newContext();
    try {
      const s = stamp();
      const sentinel = `Collab seed ${s}`;
      pageId = await openSeededPage(page, seeded, {
        title: `E4 collab ${s}`,
        doc: pmDoc(pmParagraph(sentinel)),
        sentinel,
      });

      const pageB = await contextB.newPage();
      await signIn(pageB, seeded);
      await openExistingPage(pageB, pageId, sentinel);

      // Client A types in suggest mode…
      const editorA = page.locator('.ProseMirror').first();
      await enableSuggesting(page);
      await placeCaretAtDocEnd(page, editorA);
      const typed = `REMOTE${s}`;
      await page.keyboard.type(typed);
      await expect(editorA.locator('ins[data-suggestion-id]', { hasText: typed })).toBeVisible({
        timeout: 15_000,
      });

      // …and client B receives the MARK (not just the text) over Yjs. If the
      // rewrite bypassed the editor pipeline, B would see plain or no text.
      const editorB = pageB.locator('.ProseMirror').first();
      const insB = editorB.locator('ins[data-suggestion-id]', { hasText: typed });
      await expect(insB).toBeVisible({ timeout: 20_000 });
    } finally {
      await contextB.close();
      await cleanupPage(pageId);
    }
  });

  test('(d) toggling Suggesting OFF stops wrapping mid-paragraph', async ({ page, seeded }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      const s = stamp();
      const sentinel = `Toggle seed ${s}`;
      pageId = await openSeededPage(page, seeded, {
        title: `E4 toggle-off ${s}`,
        doc: pmDoc(pmParagraph(sentinel)),
        sentinel,
      });
      const editor = page.locator('.ProseMirror').first();

      const markedWord = `AAA${s}`;
      const plainWord = `BBB${s}`;

      await enableSuggesting(page);
      await placeCaretAtDocEnd(page, editor);
      await page.keyboard.type(markedWord);
      await expect(editor.locator('ins[data-suggestion-id]', { hasText: markedWord })).toBeVisible({
        timeout: 15_000,
      });

      // Toggle OFF, type again in the same paragraph: plain text.
      const toggle = page.getByTestId('suggest-toggle-chip');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
      await placeCaretAtDocEnd(page, editor);
      await page.keyboard.type(plainWord);

      await expect(editor).toContainText(plainWord, { timeout: 15_000 });
      await expect(editor.locator('ins', { hasText: plainWord })).toHaveCount(0);
      // The earlier auto-marked run is untouched.
      await expect(
        editor.locator('ins[data-suggestion-id]', { hasText: markedWord }),
      ).toBeVisible();
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('(e) accept parity: an auto-marked insert accepts exactly like a manual one', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      const s = stamp();
      const sentinel = `Accept seed ${s}`;
      pageId = await openSeededPage(page, seeded, {
        title: `E4 accept ${s}`,
        doc: pmDoc(pmParagraph(sentinel)),
        sentinel,
      });
      const editor = page.locator('.ProseMirror').first();

      await enableSuggesting(page);
      await placeCaretAtDocEnd(page, editor);
      const typed = `ACCEPT${s}`;
      await page.keyboard.type(typed);
      const ins = editor.locator('ins[data-suggestion-id]', { hasText: typed });
      await expect(ins).toBeVisible({ timeout: 15_000 });

      // Click INTO the marked text: the toolbar tracks the suggestionId under
      // the selection (resolvable) and surfaces its Accept/Reject buttons —
      // the same affordance manual marks use (P23 #98). Accept goes through
      // the SHARED resolve() path: server POST + client-side transform mirror.
      await ins.click();
      const accept = page.getByRole('button', { name: 'Accept', exact: true });
      await expect(accept).toBeVisible({ timeout: 15_000 });
      await accept.click();

      // Identical to the manual flow: text stays, the mark is gone.
      await expect(editor.locator('ins[data-suggestion-id]')).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(editor).toContainText(typed);
      // Accepting the ACTIVE suggestion also exits suggest mode (resolve()
      // clears the open proposal), so the chip returns to its resting state.
      await expect(page.getByTestId('suggest-toggle-chip')).toHaveAttribute(
        'aria-pressed',
        'false',
        { timeout: 15_000 },
      );
    } finally {
      await cleanupPage(pageId);
    }
  });
});
