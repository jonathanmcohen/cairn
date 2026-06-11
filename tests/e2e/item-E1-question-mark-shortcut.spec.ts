// v0.10.0 Plan E E1 — bare `?` opens the keyboard-shortcuts cheat sheet.
//
// The sheet has existed since v0.6 P15 behind Mod+/ only; the dispatcher
// early-returned on every keydown without a modifier so `?` could never fire.
// It now allow-lists bare `?` (keyed off e.key — layout-independent) when
// focus is OUTSIDE editable controls. This spec proves the new trigger end to
// end plus its guards: typing `?` in the TipTap doc or the palette input must
// insert the character and never open the sheet, and Mod+/ keeps working.
//
// Determinism notes (persistent e2e dev DB): the editor-guard test creates its
// page with a unique stamp and deletes it (pages + audit_log) in finally.
import postgres from 'postgres';
import { expect, signIn, test } from '../a11y/fixtures';

function stamp(): string {
  return `e1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

type PwPage = import('@playwright/test').Page;

async function createPageViaApi(page: PwPage, title: string): Promise<string> {
  const res = await page.request.post('/api/pages', { data: { title } });
  expect(res.status(), await res.text().catch(() => '')).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function shortcutSheet(page: PwPage) {
  // sheet.tsx renders role="dialog" aria-label={t('shortcuts.title')}.
  return page.getByRole('dialog', { name: 'Keyboard shortcuts' });
}

test.describe('item E1 — bare ? opens the shortcuts cheat sheet', () => {
  test('falsifiable core: ? on the app shell opens the sheet (both triggers listed), Escape closes it', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    // page.keyboard.type sends the layout VALUE '?' (not the physical
    // Shift+/ code) — exactly the layout-independent path the dispatcher
    // keys off.
    await page.keyboard.type('?');
    const sheet = shortcutSheet(page);
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // Stale-copy check: the cheat-sheet row lists BOTH triggers. prettyKeys
    // renders '?' as-is on every platform; Mod is ⌘ (mac) / Ctrl (others), so
    // assert the layout-independent half plus the row label.
    const row = sheet.locator('li', { hasText: 'Open keyboard shortcuts' });
    await expect(row.locator('kbd')).toHaveCount(2);
    await expect(row.locator('kbd', { hasText: '?' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('editor guard: ? typed in the TipTap doc lands in the doc and never opens the sheet', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      pageId = await createPageViaApi(page, `E1 editor guard ${stamp()}`);
      await page.goto(`/pages/${pageId}`);

      const editor = page.locator('.ProseMirror').first();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await editor.click();
      await page.keyboard.type('what gives?');

      await expect(editor).toContainText('what gives?');
      await expect(shortcutSheet(page)).toHaveCount(0);
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('input guard: ? typed in the ⌘K palette input stays in the field, no sheet', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    await page.keyboard.press('ControlOrMeta+k');
    const paletteInput = page.getByPlaceholder('Search pages and actions…');
    await expect(paletteInput).toBeVisible({ timeout: 10_000 });

    await page.keyboard.type('?');
    await expect(paletteInput).toHaveValue('?');
    await expect(shortcutSheet(page)).toHaveCount(0);
  });

  test('Mod+/ unchanged: the original binding still opens the sheet', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/');

    await page.keyboard.press('ControlOrMeta+/');
    await expect(shortcutSheet(page)).toBeVisible({ timeout: 10_000 });
  });
});
