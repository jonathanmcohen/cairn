// v0.9.18 Gate 3 — runtime spec for carry-forward item #117 (heading collapse
// chevron). Boots the real app (playwright.e2e.config.ts), signs in via the
// seeded fixture, performs the exact browser repro, and asserts the UI state —
// so a green unit/JSDOM spec can't hide a browser-level regression.
//
// Shipped behavior under guard: hovering a heading reveals a collapse chevron;
// clicking it hides the section content between that heading and the next
// same-or-higher heading until expanded again. The #117 fix moved the collapse
// state into a ProseMirror plugin (decorations), so a doc redraw / remote Yjs
// edit can no longer wipe the `hidden` + `data-cairn-collapsed` attributes the
// way the old direct-DOM-mutation approach did. See
// src/components/editor/heading-collapse-extension.ts + heading-collapse.tsx,
// wired in editor.tsx.
import type { Page } from '@playwright/test';
import { getSchema } from '@tiptap/core';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { schemaExtensions } from '@/components/editor/schema';
import * as schema from '@/db/schema';
import { updatePage } from '@/lib/pages/update';
import { expect, test } from '../a11y/fixtures';

// Deterministic `h2 (Alpha) + paragraph + h2 (Bravo)` document. The paragraph
// between the two same-level headings is the block the collapse must hide while
// Bravo stays visible (equal level ends the section).
const HEADING_DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Alpha' }] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Body paragraph under Alpha' }],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Bravo' }] },
  ],
} as const;

// v0.9.19 A1 — the v0.9.18 live miss reproduced: a heading nested inside a
// column (any `block+` wrapper). The flat HEADING_DOC above is why the v0.9.18
// guard passed while real pages no-op'd: the chevron toggled the WRAPPER's
// top-level position and the decoration builder only walked top-level blocks.
const NESTED_HEADING_DOC = {
  type: 'doc',
  content: [
    {
      type: 'columnList',
      content: [
        {
          type: 'column',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'NestedHead' }],
            },
            { type: 'paragraph', content: [{ type: 'text', text: 'Nested body one' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Nested body two' }] },
          ],
        },
        {
          type: 'column',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Other column stays' }] }],
        },
      ],
    },
  ],
} as const;

/**
 * Seed the page document directly in the DB (both `pages.content` and the
 * Hocuspocus-persisted `page_yjs.state`), exactly like tests/a11y/seed.ts. The
 * editor renders from the pre-seeded Yjs state on connect, so we get the exact
 * h2/p/h2 structure deterministically instead of fighting markdown input rules.
 */
async function seedHeadingDoc(args: {
  pageId: string;
  workspaceId: string;
  doc?: typeof HEADING_DOC | typeof NESTED_HEADING_DOC;
}) {
  const docJson = args.doc ?? HEADING_DOC;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the item-117 seed');
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
  try {
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'a11y@cairn.test'))
      .limit(1);
    if (!user) throw new Error('seeded a11y user not found');

    await updatePage(db, {
      pageId: args.pageId,
      workspaceId: args.workspaceId,
      byUserId: user.id,
      adminOverride: true,
      patch: { content: docJson },
    });

    const pmSchema = getSchema(schemaExtensions());
    const ydoc = prosemirrorJSONToYDoc(pmSchema, docJson, 'default');
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

async function signIn(page: Page, seeded: { userEmail: string; userPassword: string }) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(seeded.userEmail);
  await page.locator('input[name="password"]').fill(seeded.userPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // not-'/login' predicate: '/' redirects to the landing page when the
  // workspace has pages, so a '**/' glob can miss the transient root (H1).
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

test.describe('item #117 — heading collapse chevron', () => {
  test('clicking the heading chevron collapses the section content (and expand restores)', async ({
    page,
    seeded,
  }) => {
    await seedHeadingDoc({ pageId: seeded.pageId, workspaceId: seeded.workspaceId });
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);

    const editor = page.locator('.ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    // The pre-seeded Yjs doc materializes the two headings + paragraph.
    await expect(editor.locator('h2')).toHaveCount(2, { timeout: 30_000 });

    const firstHeading = editor.locator('h2', { hasText: 'Alpha' });
    const secondHeading = editor.locator('h2', { hasText: 'Bravo' });
    const body = editor.locator('p', { hasText: 'Body paragraph under Alpha' });
    await expect(body).toBeVisible();

    // 1. Hover the first heading -> the collapse chevron appears.
    await firstHeading.hover();
    const toggle = page.locator('[data-heading-collapse-toggle]').first();
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-label', 'Collapse section');

    // 2. Click the chevron to collapse.
    await toggle.click();

    // 3. The following paragraph is hidden + carries data-cairn-collapsed, while
    //    the next same-level heading stays visible (equal level ends the
    //    section). This is the exact behavior #117 reported broken.
    await expect(body).toBeHidden();
    await expect(body).toHaveAttribute('data-cairn-collapsed', '');
    await expect(secondHeading).toBeVisible();

    // 4. The collapse STICKS — re-derived from plugin state, not raw DOM that a
    //    redraw could wipe (the #117 root cause). Re-hover + assert the toggle
    //    now offers "Expand section".
    await firstHeading.hover();
    const expandToggle = page.locator('[data-heading-collapse-toggle]').first();
    await expect(expandToggle).toHaveAttribute('aria-label', 'Expand section');

    // 5. Expand restores the hidden block.
    await expandToggle.click();
    await expect(body).toBeVisible();
    await expect(body).not.toHaveAttribute('data-cairn-collapsed', '');
  });

  // v0.9.19 A1 — the heading lives INSIDE a column. On v0.9.18 this exact flow
  // no-ops (chevron flips, nothing hides): the live miss the user reported.
  test('collapses a heading nested inside a column (v0.9.18 live miss)', async ({
    page,
    seeded,
  }) => {
    await seedHeadingDoc({
      pageId: seeded.pageId,
      workspaceId: seeded.workspaceId,
      doc: NESTED_HEADING_DOC,
    });
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);

    const editor = page.locator('.ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    const nestedHeading = editor.locator('h2', { hasText: 'NestedHead' });
    await expect(nestedHeading).toBeVisible({ timeout: 30_000 });

    const bodyOne = editor.locator('p', { hasText: 'Nested body one' });
    const bodyTwo = editor.locator('p', { hasText: 'Nested body two' });
    const otherColumn = editor.locator('p', { hasText: 'Other column stays' });
    await expect(bodyOne).toBeVisible();

    await nestedHeading.hover();
    const toggle = page.locator('[data-heading-collapse-toggle]').first();
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();

    // Both following siblings inside the SAME column hide; the sibling column
    // is untouched. On v0.9.18 these assertions fail — bodyOne stays visible.
    await expect(bodyOne).toBeHidden();
    await expect(bodyOne).toHaveAttribute('data-cairn-collapsed', '');
    await expect(bodyTwo).toBeHidden();
    await expect(otherColumn).toBeVisible();

    // Expand restores.
    await nestedHeading.hover();
    const expandToggle = page.locator('[data-heading-collapse-toggle]').first();
    await expect(expandToggle).toHaveAttribute('aria-label', 'Expand section');
    await expandToggle.click();
    await expect(bodyOne).toBeVisible();
    await expect(bodyTwo).toBeVisible();
  });
});
