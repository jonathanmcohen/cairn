// v0.10.0 Plan E E3 — heading-collapse chevron discoverability (live-deploy
// sweep #117 follow-up).
//
// The D6 chevron WORKED but was undiscoverable: the overlay mounted ONE button
// only while the pointer hovered a heading, at left:-28px in the gutter — a
// collapsed heading showed nothing once the pointer left, and touch devices
// (no hover) never saw the affordance at all. The fix renders a persistent
// chevron for EVERY visible h1/h2/h3 and reveals it with CSS
// (.heading-collapse-chevron in globals.css): rest → opacity .3 (P7), row
// hover → 1, direct
// hover/focus → 1, collapsed → always 1, (pointer: coarse) → always 1.
// Opacity-only transitions (<=150ms), so the reveal never shifts the text.
//
// RED on the old build:
//  - test (a) fails at the "chevrons are attached before any hover" count
//    assertion (the old overlay renders nothing until a heading is hovered);
//  - test (b) fails because moving the pointer off the collapsed heading
//    unmounted the only button → no [data-collapsed] chevron exists;
//  - test (c) fails because without hover the old overlay never mounts.
//
// Determinism notes (persistent e2e dev DB): each test creates its own page
// via /api/pages with a unique stamp, seeds the exact h2/p/h2/p document
// directly in the DB (pages.content + page_yjs, the item-117 recipe — the
// editor renders from the pre-seeded Yjs state on connect, no input-rule
// typing involved), and deletes it (pages cascade page_yjs; audit_log rows)
// in finally.
import { devices } from '@playwright/test';
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

type PwPage = import('@playwright/test').Page;
type PwLocator = import('@playwright/test').Locator;

// h2 (Section Alpha) + body + h2 (Section Bravo) + body. Bravo's body is the
// off-row, non-gutter pointer target used to prove the collapsed Alpha chevron
// stays visible after the mouse leaves its row.
const HEADING_DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section Alpha' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Body under alpha' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section Bravo' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Body under bravo' }] },
  ],
} as const;

function stamp(): string {
  return `e3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
 * Hocuspocus-persisted `page_yjs.state`), exactly like the item-117 spec. The
 * editor renders from the pre-seeded Yjs state on connect, so we get the exact
 * h2/p/h2/p structure deterministically instead of fighting input rules.
 */
async function seedHeadingDoc(args: {
  pageId: string;
  workspaceId: string;
  userEmail: string;
}): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the item-E3 seed');
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
      patch: { content: HEADING_DOC },
    });

    const pmSchema = getSchema(schemaExtensions());
    const ydoc = prosemirrorJSONToYDoc(pmSchema, HEADING_DOC, 'default');
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

/** Create + seed a fresh page and open it; returns the id for cleanup. */
async function openSeededPage(
  page: PwPage,
  seeded: { workspaceId: string; userEmail: string },
): Promise<string> {
  const pageId = await createPageViaApi(page, `E3 chevron ${stamp()}`);
  await seedHeadingDoc({ pageId, workspaceId: seeded.workspaceId, userEmail: seeded.userEmail });
  await page.goto(`/pages/${pageId}`);
  const editor = page.locator('.ProseMirror').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  // The pre-seeded Yjs doc materializes both headings.
  await expect(editor.locator('h2')).toHaveCount(2, { timeout: 30_000 });
  return pageId;
}

async function computedOpacity(locator: PwLocator): Promise<number> {
  return Number(await locator.evaluate((el) => getComputedStyle(el).opacity));
}

test.describe('item E3 — heading-collapse chevron discoverability', () => {
  test('(a) falsifiable core: hovering the heading text center reveals the chevron', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      pageId = await openSeededPage(page, seeded);
      const editor = page.locator('.ProseMirror').first();
      const alphaHeading = editor.locator('h2', { hasText: 'Section Alpha' });

      // Park the pointer over a body paragraph — inside the editor, off any
      // heading row. On the old build this is the no-chevron baseline.
      await editor.locator('p', { hasText: 'Body under alpha' }).hover();

      // THE RED ASSERTION on the old build: the affordance must EXIST before
      // any heading hover (persistent button per heading, hidden via opacity,
      // not unmounted). The old overlay renders zero buttons here.
      const chevrons = page.locator('[data-heading-collapse-toggle]');
      await expect(chevrons).toHaveCount(2, { timeout: 10_000 });

      // v0.10.2 P7 updated the rest tier: 30% opacity (discoverable), not 0.
      // Still opacity-tiered (NOT display:none) so the reveal transitions
      // without layout shift.
      const alphaChevron = chevrons.first();
      expect(await computedOpacity(alphaChevron)).toBeCloseTo(0.3, 2);

      // The sweep's exact repro: hover the CENTER of the heading text block.
      await alphaHeading.hover();

      // Reveal: the 120ms opacity transition lands well within the 1s poll
      // (the 150ms budget is design intent; visibility is what we assert).
      // Playwright's toBeVisible ignores opacity, so the computed-opacity poll
      // is the real assertion: row hover shows the subdued (0.5) state.
      await expect(alphaChevron).toBeVisible({ timeout: 1000 });
      await expect
        .poll(() => computedOpacity(alphaChevron), { timeout: 2000 })
        .toBeGreaterThanOrEqual(0.4);
      await expect(alphaChevron).toHaveAttribute('aria-label', 'Collapse section');
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('(b) a collapsed heading keeps its chevron visible after the pointer leaves', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      pageId = await openSeededPage(page, seeded);
      const editor = page.locator('.ProseMirror').first();
      const body = editor.locator('p', { hasText: 'Body under alpha' });

      // Collapse Section Alpha via its chevron (hover the row first — the
      // hidden chevron is pointer-events: none until the row is hovered).
      await editor.locator('h2', { hasText: 'Section Alpha' }).hover();
      const alphaChevron = page.locator('[data-heading-collapse-toggle]').first();
      await expect
        .poll(() => computedOpacity(alphaChevron), { timeout: 2000 })
        .toBeGreaterThanOrEqual(0.4);
      await alphaChevron.click();
      await expect(body).toBeHidden();

      // Move the pointer well away: onto Bravo's body — inside the editor,
      // outside Alpha's row and outside the gutter band. On the old build this
      // mousemove unmounted the only chevron.
      await editor.locator('p', { hasText: 'Body under bravo' }).hover();

      // The collapsed chevron stays at FULL opacity with no hover — collapsed
      // state must be visible. [data-collapsed] only exists on the new build.
      const collapsedChevron = page.locator('[data-heading-collapse-toggle][data-collapsed]');
      await expect(collapsedChevron).toHaveCount(1, { timeout: 10_000 });
      await expect(collapsedChevron).toHaveAttribute('aria-label', 'Expand section');
      await expect.poll(() => computedOpacity(collapsedChevron), { timeout: 2000 }).toBe(1);

      // And it stays functional: clicking it expands the section again.
      await collapsedChevron.click();
      await expect(body).toBeVisible();
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('(d) no layout shift: revealing the chevron never moves the heading text', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      pageId = await openSeededPage(page, seeded);
      const editor = page.locator('.ProseMirror').first();
      const alphaHeading = editor.locator('h2', { hasText: 'Section Alpha' });

      const before = await alphaHeading.boundingBox();
      expect(before).not.toBeNull();

      await alphaHeading.hover();
      const alphaChevron = page.locator('[data-heading-collapse-toggle]').first();
      await expect
        .poll(() => computedOpacity(alphaChevron), { timeout: 2000 })
        .toBeGreaterThanOrEqual(0.4);

      const after = await alphaHeading.boundingBox();
      expect(after).not.toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: null-checked above
      expect(after!.x).toBe(before!.x);
      // biome-ignore lint/style/noNonNullAssertion: null-checked above
      expect(after!.y).toBe(before!.y);
      // biome-ignore lint/style/noNonNullAssertion: null-checked above
      expect(after!.width).toBe(before!.width);
      // biome-ignore lint/style/noNonNullAssertion: null-checked above
      expect(after!.height).toBe(before!.height);
    } finally {
      await cleanupPage(pageId);
    }
  });
});

test.describe('item E3 — touch devices always show the chevron', () => {
  // Pixel 7 emulation (chromium-flavored): viewport + isMobile + hasTouch set
  // at context creation flips the `(pointer: coarse)` media query — the CSS
  // path that keeps every chevron visible on devices with no hover.
  // defaultBrowserType is worker-scoped and must be stripped before test.use
  // inside a describe (it would force a new worker and playwright refuses).
  const { defaultBrowserType: _ignoredBrowserType, ...pixel7 } = devices['Pixel 7'];
  test.use(pixel7);

  test('(c) pointer-coarse: chevrons are visible with no hover at all', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    let pageId: string | null = null;
    try {
      pageId = await openSeededPage(page, seeded);

      // Guard the emulation itself so a silent fallback to a fine pointer
      // can't make this test pass for the wrong reason.
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

      // No hover happened — both chevrons must be attached AND fully opaque.
      // On the old build nothing mounts without a heading mousemove.
      const chevrons = page.locator('[data-heading-collapse-toggle]');
      await expect(chevrons).toHaveCount(2, { timeout: 10_000 });
      await expect.poll(() => computedOpacity(chevrons.first()), { timeout: 2000 }).toBe(1);
      await expect.poll(() => computedOpacity(chevrons.nth(1)), { timeout: 2000 }).toBe(1);
    } finally {
      await cleanupPage(pageId);
    }
  });
});
