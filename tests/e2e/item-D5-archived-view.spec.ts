// v0.10.0 D5 — Archived-pages browse view.
//
// `archived` is a lifecycle status (src/lib/pages/pages tree + search both
// hide it) whose promised `/archived` route was never built — an archived page
// was recoverable only by direct URL. This spec proves the new view end to
// end, plus the public dead-link fixes: public-site.ts now status-filters the
// `/s/<slug>` index, and share.ts requirePublicPageAccess (the real `/p/<slug>`
// gate — public.ts getPublishedPageBySlug had the filter but isn't what the
// route calls) now requires status='published' too.
//
// Determinism notes (persistent e2e dev DB):
//  - every page/site slug carries a unique stamp; cleanup happens in finally
//  - sidebar membership is asserted via GET /api/pages/tree (the same
//    flattenedPageTree the virtualized sidebar renders) — the windowed list
//    DOM only mounts visible rows, so DOM-presence asserts would be flaky
//  - search is asserted via GET /api/search (the ⌘K palette's backing route)
import postgres from 'postgres';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

function stamp(): string {
  return `d5-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

type PwPage = import('@playwright/test').Page;

async function createPageViaApi(page: PwPage, title: string): Promise<string> {
  const res = await page.request.post('/api/pages', { data: { title } });
  expect(res.status(), await res.text().catch(() => '')).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function setStatus(page: PwPage, pageId: string, to: string): Promise<void> {
  const res = await page.request.post(`/api/pages/${pageId}/status`, { data: { to } });
  expect(res.status(), `status → ${to}: ${await res.text().catch(() => '')}`).toBe(200);
}

async function treeIds(page: PwPage): Promise<string[]> {
  const res = await page.request.get('/api/pages/tree');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { nodes: { id: string }[] };
  return body.nodes.map((n) => n.id);
}

async function searchIds(page: PwPage, q: string): Promise<string[]> {
  const res = await page.request.get(`/api/search?q=${encodeURIComponent(q)}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { results: { id: string }[] };
  return body.results.map((r) => r.id);
}

async function cleanupPage(pageId: string | null): Promise<void> {
  if (!pageId) return;
  await withSql(async (sql) => {
    await sql`delete from audit_log where target_id = ${pageId}::uuid`;
    await sql`delete from pages where id = ${pageId}::uuid`;
  });
}

test.describe('item D5 — archived-pages browse view', () => {
  test('falsifiable core: archive hides from sidebar tree, /archived lists it, un-archive restores to draft', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const title = `D5 core ${stamp()}`;
    let pageId: string | null = null;
    try {
      pageId = await createPageViaApi(page, title);

      // New page is 'draft' (workspace default) and the creator sees their own
      // drafts in the tree — establish presence so the absence below means
      // something.
      expect(await treeIds(page)).toContain(pageId);

      // Archive through the REAL status route (draft → archived is legal).
      await setStatus(page, pageId, 'archived');

      // Gone from the sidebar tree…
      expect(await treeIds(page)).not.toContain(pageId);

      // …but listed on /archived.
      await page.goto('/archived');
      const row = page.locator('li', { hasText: title });
      await expect(row).toBeVisible({ timeout: 15_000 });

      // Un-archive from the row (drives archived → draft via the status API).
      await row.getByRole('button', { name: 'Un-archive' }).click();
      await expect(row).toHaveCount(0);

      // Status is draft again and the page is back in the tree.
      const statusRes = await page.request.get(`/api/pages/${pageId}/status`);
      expect(((await statusRes.json()) as { status: string }).status).toBe('draft');
      expect(await treeIds(page)).toContain(pageId);
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('public dead-link trap: archiving drops the page from /s/<slug> index AND /p/<slug> 404s', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const mark = stamp();
    const title = `D5 public ${mark}`;
    const siteSlug = `d5-site-${mark}`;
    let pageId: string | null = null;
    let prevSite: { slug: string | null; enabled: boolean } | null = null;
    try {
      // Point the workspace public site at a stamped slug (direct DB — this is
      // the same column setPublicSite writes; restored in finally).
      await withSql(async (sql) => {
        const [ws] = await sql`
          select public_site_slug, public_site_enabled
          from workspaces where id = ${seeded.workspaceId}::uuid
        `;
        prevSite = {
          slug: (ws as { public_site_slug: string | null }).public_site_slug,
          enabled: (ws as { public_site_enabled: boolean }).public_site_enabled,
        };
        await sql`
          update workspaces
          set public_site_slug = ${siteSlug}, public_site_enabled = true
          where id = ${seeded.workspaceId}::uuid
        `;
      });

      pageId = await createPageViaApi(page, title);
      // The lifecycle matrix has no draft→published hop; walk draft→review→published.
      await setStatus(page, pageId, 'review');
      await setStatus(page, pageId, 'published');
      // Mint the public share slug (`published` flag + public_slug).
      const pubRes = await page.request.post(`/api/pages/${pageId}/publish`);
      expect(pubRes.status(), await pubRes.text().catch(() => '')).toBe(200);
      const { slug } = (await pubRes.json()) as { slug: string };

      // Listed on the site index and publicly rendered.
      const indexBefore = await page.request.get(`/s/${siteSlug}`);
      expect(indexBefore.status()).toBe(200);
      expect(await indexBefore.text()).toContain(title);
      expect((await page.request.get(`/p/${slug}`)).status()).toBe(200);

      // Archive (published → archived is legal).
      await setStatus(page, pageId, 'archived');

      // The fix: the site index no longer lists the page (was the dead-link
      // trap — public-site.ts didn't status-filter)…
      const indexAfter = await page.request.get(`/s/${siteSlug}`);
      expect(indexAfter.status()).toBe(200);
      expect(await indexAfter.text()).not.toContain(title);
      // …and the public render is gone (share.ts requirePublicPageAccess —
      // the route's actual gate — now requires status='published').
      expect((await page.request.get(`/p/${slug}`)).status()).toBe(404);
    } finally {
      await withSql(async (sql) => {
        if (prevSite) {
          await sql`
            update workspaces
            set public_site_slug = ${prevSite.slug}, public_site_enabled = ${prevSite.enabled}
            where id = ${seeded.workspaceId}::uuid
          `;
        }
      });
      await cleanupPage(pageId);
    }
  });

  test('search: archived page disappears from default search results', async ({ page, seeded }) => {
    await signIn(page, seeded);
    // Single token so the trigram title fallback matches it exactly.
    const title = `d5search${stamp().replace(/-/g, '')}`;
    let pageId: string | null = null;
    try {
      pageId = await createPageViaApi(page, title);
      // Make it searchable first: review + published statuses are in the
      // default result set (draft/archived are excluded in search.ts).
      await setStatus(page, pageId, 'review');
      expect(await searchIds(page, title)).toContain(pageId);
      await setStatus(page, pageId, 'published');
      expect(await searchIds(page, title)).toContain(pageId);

      // Archive → gone from default search. There is no `status:` operator
      // projection today (filtersFromOperators drops it), so "archived is
      // findable ONLY via /archived" is the contract this asserts.
      await setStatus(page, pageId, 'archived');
      expect(await searchIds(page, title)).not.toContain(pageId);
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('roles: editor sees /archived with Un-archive; viewer gets the read-only list', async ({
    browser,
    page,
    seeded,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    await signIn(page, seeded);
    const title = `D5 roles ${stamp()}`;
    let pageId: string | null = null;
    try {
      pageId = await createPageViaApi(page, title);
      await setStatus(page, pageId, 'archived');

      // Second user (default role: editor) CAN browse /archived and gets the
      // Un-archive affordance. The underlying write is gated server-side by
      // requirePageAccess(pageId, 'editor') on the status route (covered by
      // the shared requireRole/requirePageAccess suites).
      const editor = await seedSecondUser(databaseUrl, { workspaceId: seeded.workspaceId });
      const { context, page: editorPage } = await signInSecondUser(browser, editor);
      try {
        await editorPage.goto('/archived');
        const row = editorPage.locator('li', { hasText: title });
        await expect(row).toBeVisible({ timeout: 15_000 });
        await expect(row.getByRole('button', { name: 'Un-archive' })).toBeVisible();
      } finally {
        await context.close();
      }

      // Third seeded role is cheap with the same helper: a viewer sees the
      // list read-only — no Un-archive button anywhere on the page.
      const viewer = await seedSecondUser(databaseUrl, {
        workspaceId: seeded.workspaceId,
        email: 'd5-viewer@cairn.test',
        password: 'd5-viewer-password-1',
        role: 'viewer',
      });
      const { context: viewerCtx, page: viewerPage } = await signInSecondUser(browser, viewer);
      try {
        await viewerPage.goto('/archived');
        const row = viewerPage.locator('li', { hasText: title });
        await expect(row).toBeVisible({ timeout: 15_000 });
        await expect(viewerPage.getByRole('button', { name: 'Un-archive' })).toHaveCount(0);
      } finally {
        await viewerCtx.close();
      }
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('tenant isolation: /archived never lists another workspace’s archived page', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const mark = stamp();
    const ownTitle = `D5 own ${mark}`;
    const foreignTitle = `D5 foreign ${mark}`;
    let ownPageId: string | null = null;
    let foreignWsId: string | null = null;
    try {
      ownPageId = await createPageViaApi(page, ownTitle);
      await setStatus(page, ownPageId, 'archived');

      // Foreign workspace + archived page seeded via direct DB (the D2/D3
      // foreign-workspace pattern). created_by reuses the seeded user — the
      // FK has no workspace constraint, and it spares a second user row.
      await withSql(async (sql) => {
        const [user] = await sql`select id from users where email = ${seeded.userEmail}`;
        if (!user) throw new Error('seeded user not found');
        const [ws] = await sql`
          insert into workspaces (name, slug)
          values (${`D5 Foreign ${mark}`}, ${`d5-foreign-${mark}`})
          returning id
        `;
        foreignWsId = (ws as { id: string }).id;
        await sql`
          insert into pages (workspace_id, created_by, title, content, status)
          values (${foreignWsId}::uuid, ${(user as { id: string }).id}::uuid,
                  ${foreignTitle}, '{}'::jsonb, 'archived')
        `;
      });

      // API surface: only the caller's workspace rows.
      const res = await page.request.get('/api/archived');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { entries: { id: string; title: string }[] };
      const titles = body.entries.map((e) => e.title);
      expect(titles).toContain(ownTitle);
      expect(titles).not.toContain(foreignTitle);

      // UI surface agrees.
      await page.goto('/archived');
      await expect(page.locator('li', { hasText: ownTitle })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('li', { hasText: foreignTitle })).toHaveCount(0);
    } finally {
      await cleanupPage(ownPageId);
      await withSql(async (sql) => {
        if (foreignWsId) {
          // pages.workspace_id FK cascades; delete pages first anyway so the
          // created_by restrict-FK never blocks a future user cleanup.
          await sql`delete from pages where workspace_id = ${foreignWsId}::uuid`;
          await sql`delete from workspaces where id = ${foreignWsId}::uuid`;
        }
      });
    }
  });
});
