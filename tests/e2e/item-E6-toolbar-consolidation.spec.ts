// v0.10.0 Plan E E6 — editor/page toolbar consolidation (polish-audit row 5).
//
// The page-detail view used to stack TWO toolbars: the page action bar
// (icon/title/status/backlinks/focus-reader/panels/menu, rendered by
// pages/[pageId]/page.tsx) and the editor control strip (Suggesting / Mark
// buttons / open-count chip / Bibliography / presence / Live pill / Outline,
// rendered by editor.tsx above the editor body). E6 folds the editor group
// into the page action bar: page.tsx reserves a slot (EDITOR_TOOLBAR_SLOT_ID)
// as the bar's last flex child and editor.tsx portals its control group there
// — ONE toolbar row, with state staying in editor.tsx.
//
// RED on the old build:
//  - (a) the Suggesting chip lives in a separate strip inside the editor
//    body, so `[data-testid="page-toolbar"]` (and with it the chip-inside-
//    the-bar locator) resolves to nothing — the falsifiable core fails.
//
// Behavior contracts re-asserted (refactor spec — nothing new, nothing lost):
//  - (b) every control still fires from the merged bar: Suggesting toggles
//    (E4's auto-mark entry point), Outline opens the drawer (D8), Focus mode
//    hides the chrome (O2) and exits.
//  - (c) the #188 / D3-from-v0.9.9 lock contract: under page lock the
//    Suggesting + Bibliography controls stay MOUNTED but DISABLED.
//  - (d) 360px viewport: the bar wraps (flex-wrap) — no control is pushed
//    off-screen (the v0.9.19 workspace-switcher overflow lesson); each key
//    control is reachable and enabled, and Outline actually opens.
//
// Determinism notes (persistent e2e dev DB): each test creates its own page
// via /api/pages with a unique stamp and deletes it (plus its audit rows) in
// finally — the item-E4 cleanup recipe.
import postgres from 'postgres';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor, pmDoc, pmHeading, pmParagraph } from './util';

type PwPage = import('@playwright/test').Page;

function stamp(): string {
  return `e6${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupPage(pageId: string | null): Promise<void> {
  if (!pageId) return;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from audit_log where target_id = ${pageId}::uuid`;
    await sql`delete from pages where id = ${pageId}::uuid`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Create + open a page whose doc has a heading (so the Outline drawer lists
 * something) and a sentinel paragraph, waiting for the full editor readiness
 * gate (ProseMirror + sentinel + "Live" pill) before any toolbar interaction.
 */
async function openToolbarPage(page: PwPage, s: string): Promise<string> {
  const sentinel = `Toolbar seed ${s}`;
  const pageId = await createPageViaApi(
    page,
    `E6 toolbar ${s}`,
    pmDoc(pmHeading(2, `Section ${s}`), pmParagraph(sentinel)),
  );
  await openPageEditor(page, pageId, sentinel);
  return pageId;
}

test.describe('item E6 — one consolidated page/editor toolbar row', () => {
  test('(a) falsifiable core: the editor controls render INSIDE the page action bar', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      pageId = await openToolbarPage(page, stamp());

      // Exactly one consolidated toolbar container on the page.
      const bar = page.getByTestId('page-toolbar');
      await expect(bar).toHaveCount(1);

      // Page-level control: the lifecycle status picker lives in the bar.
      await expect(bar.getByRole('button', { name: 'Change status' })).toBeVisible();

      // THE RED ASSERTIONS on the old build: the editor-owned controls used to
      // render in a second stacked strip inside the editor body — none of
      // these locators (scoped to the page action bar) resolved.
      await expect(bar.getByTestId('suggest-toggle-chip')).toBeVisible();
      await expect(bar.getByRole('button', { name: /bibliography/i })).toBeVisible();
      await expect(bar.getByTitle('Live')).toBeVisible();
      await expect(bar.getByRole('button', { name: 'Outline', exact: true })).toBeVisible();

      // And they render there ONLY — no leftover second strip anywhere else.
      await expect(page.getByTestId('suggest-toggle-chip')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Outline', exact: true })).toHaveCount(1);
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('(b) every control still functions from the merged bar', async ({ page, seeded }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      pageId = await openToolbarPage(page, stamp());
      const bar = page.getByTestId('page-toolbar');

      // Suggesting ON (the E4 auto-mark entry point): aria-pressed flips after
      // the open-suggestion POST resolves, and the Mark buttons join the bar.
      const suggestToggle = bar.getByTestId('suggest-toggle-chip');
      await suggestToggle.click();
      await expect(suggestToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
      await expect(bar.getByRole('button', { name: 'Mark selection as inserted' })).toBeVisible();
      await expect(bar.getByRole('button', { name: 'Mark selection as deleted' })).toBeVisible();
      // …and back OFF (revert).
      await suggestToggle.click();
      await expect(suggestToggle).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
      await expect(bar.getByRole('button', { name: 'Mark selection as inserted' })).toHaveCount(0);

      // Outline drawer (D8) opens from the bar and closes again.
      const outlineToggle = bar.getByRole('button', { name: 'Outline', exact: true });
      await outlineToggle.click();
      const drawer = page.locator('aside[aria-label="Outline"]');
      await expect(drawer).toBeVisible();
      await expect(outlineToggle).toHaveAttribute('aria-pressed', 'true');
      await drawer.getByRole('button', { name: 'Hide outline' }).click();
      await expect(drawer).toHaveCount(0);

      // Focus mode (O2): chrome hides, the floating exit control restores it.
      const sidebar = page.locator('[data-cairn-workspace-sidebar]');
      await expect(sidebar).toBeVisible();
      await bar.getByRole('button', { name: 'Focus mode' }).click();
      await expect(sidebar).toBeHidden();
      await page.getByRole('button', { name: 'Exit focus mode' }).click();
      await expect(sidebar).toBeVisible();
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('(c) lock contract (#188): Suggesting + Bibliography stay visible but disabled', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      const s = stamp();
      pageId = await openToolbarPage(page, s);

      // Lock the page through the real API (v0.9 G2 P14), then reload so the
      // server-rendered lock state reaches the editor.
      const locked = await page.request.post(`/api/pages/${pageId}/lock`, { data: {} });
      expect(locked.ok(), `POST /lock failed: ${locked.status()}`).toBe(true);
      await openPageEditor(page, pageId, `Toolbar seed ${s}`);

      const bar = page.getByTestId('page-toolbar');
      const suggestToggle = bar.getByTestId('suggest-toggle-chip');
      const bibliography = bar.getByRole('button', { name: /bibliography/i });

      // Mounted-but-disabled: present in the merged bar, not removed…
      await expect(suggestToggle).toBeVisible();
      await expect(bibliography).toBeVisible();
      // …and disabled while the lock holds.
      await expect(suggestToggle).toBeDisabled();
      await expect(bibliography).toBeDisabled();
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('(d) 360px viewport: the bar wraps — every key control stays reachable', async ({
    page,
    seeded,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      pageId = await openToolbarPage(page, stamp());
      const bar = page.getByTestId('page-toolbar');

      const controls = [
        ['Suggesting chip', bar.getByTestId('suggest-toggle-chip')],
        ['Bibliography', bar.getByRole('button', { name: /bibliography/i })],
        ['Outline', bar.getByRole('button', { name: 'Outline', exact: true })],
        ['Status', bar.getByRole('button', { name: 'Change status' })],
      ] as const;

      for (const [label, control] of controls) {
        await control.scrollIntoViewIfNeeded();
        await expect(control, `${label} must be visible at 360px`).toBeVisible();
        await expect(control, `${label} must be enabled at 360px`).toBeEnabled();
        // The overflow lesson (v0.9.19): nothing may be pushed past the
        // viewport's right edge — the bar wraps instead.
        const box = await control.boundingBox();
        expect(box, `${label} must have a bounding box`).not.toBeNull();
        if (box) {
          expect(box.x, `${label} starts on-screen`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, `${label} ends on-screen`).toBeLessThanOrEqual(360);
        }
      }

      // And a control actually FIRES at this width: Outline round-trip.
      await bar.getByRole('button', { name: 'Outline', exact: true }).click();
      await expect(page.locator('aside[aria-label="Outline"]')).toBeVisible();
    } finally {
      await cleanupPage(pageId);
    }
  });
});
