// v0.10.2 P18 — Cmd-K result count + "still indexing" indicator.
//
// Behavior under guard: the search palette (src/components/search-palette.tsx)
// shows a result-count status line (NEW — no count existed) and, when the
// workspace has pages whose embedding row is missing or content-hash-stale, a
// Clock icon + "still indexing" label. The count comes from the new
// `pending_embeddings` field on GET /api/search (computed by
// countPendingEmbeddings — LEFT JOIN truth, non-admin visible; the unit test
// in tests/lib/search/embedding-status.test.ts pins the SQL semantics:
// missing/stale/deleted/encrypted/workspace scoping).
//
// Determinism note: the e2e harness ships no local embedding model, so the
// fire-and-forget embedPage hook always fails — every page created here is
// deterministically pending (the indicator reflects REAL DB state, not a
// hardcoded flag). The zero-state guard is pinned by intercepting the
// response with pending_embeddings: 0.
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi } from './util';

test.describe('item P18 — embedding pending indicator in Cmd-K', () => {
  test('pending pages light the count line + Clock through real API truth', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/');

    // Create a page through the real API: the harness embed hook fails, so
    // this page's embedding row stays missing → pending count >= 1.
    const title = `P18 pending fixture ${Date.now()}`;
    await createPageViaApi(page, title);

    await page.keyboard.press('Meta+k');
    const input = page.locator('[data-cairn-palette] input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill(title);

    const status = page.getByTestId('search-result-status');
    await expect(status).toBeVisible({ timeout: 15_000 });
    await expect(status).toContainText(/\d+ results/);

    const pending = page.getByTestId('search-indexing-pending');
    await expect(pending).toBeVisible();
    await expect(pending).toContainText(/\d+ still indexing/);
    await expect(pending.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  });

  test('zero pending hides the Clock but keeps the result count', async ({ page, seeded }) => {
    await signIn(page, seeded);
    // Pin the zero state: pass the real response through with the pending
    // count forced to 0 — the palette must keep the count line and drop the
    // indexing span.
    await page.route('**/api/search?*', async (route) => {
      const real = await route.fetch();
      const body = (await real.json()) as Record<string, unknown>;
      body.pending_embeddings = 0;
      await route.fulfill({ response: real, body: JSON.stringify(body) });
    });

    await page.goto('/');
    await page.keyboard.press('Meta+k');
    const input = page.locator('[data-cairn-palette] input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill(`p18 zero state ${Date.now()}`);

    const status = page.getByTestId('search-result-status');
    await expect(status).toBeVisible({ timeout: 15_000 });
    await expect(status).toContainText(/\d+ results/);
    await expect(page.getByTestId('search-indexing-pending')).toHaveCount(0);
  });
});
