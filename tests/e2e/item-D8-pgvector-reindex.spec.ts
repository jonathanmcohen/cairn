// v0.10.0 D8 — pgvector index rebuild (POST/GET /api/admin/search/reindex +
// the "Semantic search index" card on /settings/admin/health).
//
// The job has two phases: a vectors pass (reindexEmbeddings — on this e2e box
// the local embedding model files are ABSENT, so per-page embeds reject and
// land in vectors.errors; that is the environment, not a bug) and the index
// pass (REINDEX INDEX CONCURRENTLY page_embeddings_embedding_hnsw_idx). The
// falsifiable core is that the run still ends state:'done' WITH a vectors
// summary — proving per-page embed failures don't kill the rebuild and the
// REINDEX completed outside a transaction.
//
// Determinism notes (persistent e2e dev DB + per-process job registry):
//  - the registry survives across specs within one harness boot, so every
//    test first waits for any in-flight job to settle (waitForIdle)
//  - the vectors pass enumerates every page in the dev DB, so polls allow
//    up to 60s
//  - the search-mid-rebuild page is stamped and cleaned up in finally
import postgres from 'postgres';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

function stamp(): string {
  return `d8-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

type ReindexSummary = { processed: number; embedded: number; skipped: number; errors: number };
type RebuildJob = {
  id: string;
  state: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt: string | null;
  phase: 'vectors' | 'index' | null;
  vectors: ReindexSummary | null;
  error: string | null;
};

const SETTLE_TIMEOUT_MS = 60_000;

async function getJob(page: PwPage): Promise<RebuildJob | null> {
  const res = await page.request.get('/api/admin/search/reindex');
  expect(res.status(), await res.text().catch(() => '')).toBe(200);
  return ((await res.json()) as { job: RebuildJob | null }).job;
}

/** Poll GET until the registry's job leaves 'running' (or was never run). */
async function waitForIdle(page: PwPage): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const job = await getJob(page);
    if (job === null || job.state !== 'running') return;
    await page.waitForTimeout(1_000);
  }
  throw new Error('a previous rebuild job never settled');
}

async function waitForSettled(page: PwPage): Promise<RebuildJob> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const job = await getJob(page);
    if (job && job.state !== 'running') return job;
    await page.waitForTimeout(1_000);
  }
  throw new Error('rebuild job never settled within the poll window');
}

async function createPageViaApi(page: PwPage, title: string): Promise<string> {
  const res = await page.request.post('/api/pages', { data: { title } });
  expect(res.status(), await res.text().catch(() => '')).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function cleanupPage(pageId: string | null): Promise<void> {
  if (!pageId) return;
  await withSql(async (sql) => {
    await sql`delete from audit_log where target_id = ${pageId}::uuid`;
    await sql`delete from pages where id = ${pageId}::uuid`;
  });
}

test.describe('item D8 — pgvector index rebuild', () => {
  test('falsifiable core: POST starts the job (202) and it settles done with a vectors summary', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await waitForIdle(page);

    const res = await page.request.post('/api/admin/search/reindex');
    expect(res.status(), await res.text().catch(() => '')).toBe(202);
    const { job } = (await res.json()) as { job: RebuildJob };
    expect(job.state).toBe('running');

    const settled = await waitForSettled(page);
    expect(settled.id).toBe(job.id);
    // 'done', NOT 'error': the vectors pass on this box rejects per page
    // (no local model files) — those failures must be summarized, and the
    // index pass (REINDEX CONCURRENTLY) must still have completed.
    expect(settled.state, settled.error ?? '').toBe('done');
    expect(settled.finishedAt).not.toBeNull();
    expect(settled.vectors).not.toBeNull();
    const vectors = settled.vectors as ReindexSummary;
    for (const key of ['processed', 'embedded', 'skipped', 'errors'] as const) {
      expect(typeof vectors[key]).toBe('number');
      expect(vectors[key]).toBeGreaterThanOrEqual(0);
    }
  });

  test('debounce: two concurrent POSTs never interleave two running jobs', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await waitForIdle(page);

    const [r1, r2] = await Promise.all([
      page.request.post('/api/admin/search/reindex'),
      page.request.post('/api/admin/search/reindex'),
    ]);
    const statuses = [r1.status(), r2.status()];
    const job1 = ((await r1.json()) as { job: RebuildJob }).job;
    const job2 = ((await r2.json()) as { job: RebuildJob }).job;

    // At least one of the pair actually started a job.
    expect(statuses).toContain(202);
    // A 200 means "debounced onto the running job" — the ids must match. If
    // both are 202 the first run finished before the second arrived (no
    // overlap), which is a legal sequential outcome on a fast box.
    if (statuses.includes(200)) {
      expect(job1.id).toBe(job2.id);
    }

    // The real contract: after both settle, the registry holds exactly one
    // job (one of the two ids) and it ends 'done'.
    const settled = await waitForSettled(page);
    expect([job1.id, job2.id]).toContain(settled.id);
    expect(settled.state, settled.error ?? '').toBe('done');
  });

  test('search keeps answering mid-rebuild (CONCURRENTLY contract + FTS fallback)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    // Single token (no hyphens) so the trigram title fallback matches exactly,
    // and walk the page to 'review' — drafts are excluded from default search
    // (the D5 lifecycle contract), so a fresh page would never appear no
    // matter what the index is doing.
    const term = `d8search${stamp().replace(/-/g, '')}`;
    let pageId: string | null = null;
    try {
      pageId = await createPageViaApi(page, term);
      const statusRes = await page.request.post(`/api/pages/${pageId}/status`, {
        data: { to: 'review' },
      });
      expect(statusRes.status(), await statusRes.text().catch(() => '')).toBe(200);

      await waitForIdle(page);
      const kicked = await page.request.post('/api/admin/search/reindex');
      expect([200, 202]).toContain(kicked.status());

      // Immediately mid-rebuild: the FTS arm answers even while pgvector is
      // being reindexed (and even though embeddings are stale on this box).
      const res = await page.request.get(`/api/search?q=${encodeURIComponent(term)}`);
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
      const body = (await res.json()) as { results: { id: string }[] };
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results.map((r) => r.id)).toContain(pageId);

      const settled = await waitForSettled(page);
      expect(settled.state, settled.error ?? '').toBe('done');
    } finally {
      await cleanupPage(pageId);
    }
  });

  test('roles: editor and viewer get 403 from both POST and GET', async ({ browser, seeded }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');

    // Dedicated accounts (NOT the shared a11y-2 user — the dev DB is
    // persistent and another spec may have changed that user's role).
    const editor = await seedSecondUser(databaseUrl, {
      workspaceId: seeded.workspaceId,
      email: 'd8-editor@cairn.test',
      password: 'd8-editor-password-1',
      role: 'editor',
    });
    const { context, page: editorPage } = await signInSecondUser(browser, editor);
    try {
      expect((await editorPage.request.post('/api/admin/search/reindex')).status()).toBe(403);
      expect((await editorPage.request.get('/api/admin/search/reindex')).status()).toBe(403);
    } finally {
      await context.close();
    }

    const viewer = await seedSecondUser(databaseUrl, {
      workspaceId: seeded.workspaceId,
      email: 'd8-viewer@cairn.test',
      password: 'd8-viewer-password-1',
      role: 'viewer',
    });
    const { context: viewerCtx, page: viewerPage } = await signInSecondUser(browser, viewer);
    try {
      expect((await viewerPage.request.post('/api/admin/search/reindex')).status()).toBe(403);
      expect((await viewerPage.request.get('/api/admin/search/reindex')).status()).toBe(403);
    } finally {
      await viewerCtx.close();
    }
  });

  test('UI: the health-page card runs a rebuild — running state, then the done badge', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await waitForIdle(page);

    await page.goto('/settings/admin/health');
    const card = page.getByTestId('reindex-card');
    await expect(card).toBeVisible({ timeout: 15_000 });

    const button = page.getByTestId('reindex-rebuild');
    await expect(button).toBeEnabled({ timeout: 15_000 });
    await button.click();

    // The POST response lands the running job in card state immediately; on
    // a fast box the first 2s poll may already flip it to done — accept
    // either, then require the settled done badge.
    const badge = page.getByTestId('reindex-state-badge');
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveAttribute('data-state', /running|done/);

    await expect(badge).toHaveAttribute('data-state', 'done', { timeout: SETTLE_TIMEOUT_MS });
    await expect(button).toBeEnabled();
    // The last-run record renders the vectors summary (errors included).
    await expect(page.getByTestId('reindex-vectors-summary')).toBeVisible();
  });
});
