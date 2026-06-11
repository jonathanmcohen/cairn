// v0.10.0 D6 — storage usage indicator + quota admin.
//
// Backend (v0.6.0 P21) has had per-workspace storage quotas for ages; D6 wires
// the surface: GET /api/storage/usage (viewer-gated), PATCH
// /api/admin/storage-quota (+ /reconcile), a 413 quota error on /api/upload
// that names the remaining space, the member-visible meter on
// /settings/account/profile (the /settings landing — the whole
// /settings/workspace group is admin-gated), and the admin console at
// /settings/admin/storage.
//
// Determinism notes (persistent e2e dev DB):
//  - the seeded workspace's quota row is captured up front and restored in
//    finally (limit from the snapshot; used recomputed from sum(files.size)
//    after deleting this spec's stamped uploads) so the upload specs that run
//    against the same workspace never see a leftover cap
//  - usage math is relative to a fresh GET (other specs may have uploaded
//    files into the seeded workspace before us)
import postgres from 'postgres';
import { formatBytes } from '@/lib/quotas/format';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

function stamp(): string {
  return `d6-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

type Usage = { usedBytes: number; limitBytes: number | null };

type QuotaSnapshot = { existed: boolean; limit: number | null };

/** Capture the seeded workspace's quota row so finally can put it back. */
async function captureQuota(workspaceId: string): Promise<QuotaSnapshot> {
  return withSql(async (sql) => {
    const rows = await sql`
      select storage_bytes_limit from workspace_quotas
      where workspace_id = ${workspaceId}::uuid
    `;
    if (rows.length === 0) return { existed: false, limit: null };
    const limit = (rows[0] as { storage_bytes_limit: string | number | null }).storage_bytes_limit;
    return { existed: true, limit: limit === null ? null : Number(limit) };
  });
}

/**
 * Restore the quota row exactly as found: no row → delete; row → restore the
 * captured limit and recompute used from sum(files.size) (this spec's stamped
 * uploads are deleted first by cleanupFiles, and blindly writing a captured
 * counter would re-introduce drift if other files were uploaded meanwhile).
 */
async function restoreQuota(workspaceId: string, snap: QuotaSnapshot): Promise<void> {
  await withSql(async (sql) => {
    if (!snap.existed) {
      await sql`delete from workspace_quotas where workspace_id = ${workspaceId}::uuid`;
      return;
    }
    await sql`
      update workspace_quotas
      set storage_bytes_limit = ${snap.limit}::bigint,
          storage_bytes_used = (
            select coalesce(sum(size), 0) from files
            where workspace_id = ${workspaceId}::uuid
          )
      where workspace_id = ${workspaceId}::uuid
    `;
  });
}

/** Delete this spec's stamped uploads (rows only; blobs are dev-disk noise). */
async function cleanupFiles(workspaceId: string, mark: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      delete from files
      where workspace_id = ${workspaceId}::uuid and name like ${`%${mark}%`}
    `;
  });
}

async function getUsage(page: PwPage): Promise<Usage> {
  const res = await page.request.get('/api/storage/usage');
  expect(res.status(), await res.text().catch(() => '')).toBe(200);
  return (await res.json()) as Usage;
}

async function patchLimit(page: PwPage, limitBytes: number | null) {
  return page.request.patch('/api/admin/storage-quota', { data: { limitBytes } });
}

async function upload(page: PwPage, name: string, bytes: number) {
  return page.request.post('/api/upload', {
    multipart: {
      file: { name, mimeType: 'text/plain', buffer: Buffer.alloc(bytes, 97) },
    },
  });
}

const KB = 1024;

test.describe('item D6 — storage usage indicator + quota admin', () => {
  test('falsifiable core: set limit, in-budget upload grows usage, over-budget upload 413s with formatted remaining', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const mark = stamp();
    const snap = await captureQuota(seeded.workspaceId);
    try {
      const before = await getUsage(page);
      const limit = before.usedBytes + 64 * KB;

      const patchRes = await patchLimit(page, limit);
      expect(patchRes.status(), await patchRes.text().catch(() => '')).toBe(200);
      expect(((await patchRes.json()) as Usage).limitBytes).toBe(limit);
      expect((await getUsage(page)).limitBytes).toBe(limit);

      // 16 KB fits inside the 64 KB headroom → 201, counter grows by 16 KB.
      const okRes = await upload(page, `${mark}-fit.txt`, 16 * KB);
      expect(okRes.status(), await okRes.text().catch(() => '')).toBe(201);
      const afterFit = await getUsage(page);
      expect(afterFit.usedBytes).toBe(before.usedBytes + 16 * KB);

      // 64 KB exceeds the 48 KB now remaining → 413 naming the remaining space.
      const remaining = limit - afterFit.usedBytes;
      const rejRes = await upload(page, `${mark}-over.txt`, 64 * KB);
      expect(rejRes.status()).toBe(413);
      const body = (await rejRes.json()) as { error: string; remainingBytes: number };
      expect(body.error).toContain(`${formatBytes(remaining)} remaining`);
      expect(body.error).toContain(`file is ${formatBytes(64 * KB)}`);
      expect(body.remainingBytes).toBe(remaining);

      // The rejected upload must not have moved the counter.
      expect((await getUsage(page)).usedBytes).toBe(afterFit.usedBytes);
    } finally {
      await cleanupFiles(seeded.workspaceId, mark);
      await restoreQuota(seeded.workspaceId, snap);
    }
  });

  test('drift + reconcile: a skewed counter snaps back to sum(files.size)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const snap = await captureQuota(seeded.workspaceId);
    try {
      // Make sure the row exists, then skew it by +1 MB via direct SQL (the
      // crash-between-blob-and-row failure mode reconcile exists for).
      await getUsage(page);
      await withSql(async (sql) => {
        await sql`
          update workspace_quotas
          set storage_bytes_used = storage_bytes_used + ${1024 * KB}::bigint
          where workspace_id = ${seeded.workspaceId}::uuid
        `;
      });

      const res = await page.request.post('/api/admin/storage-quota/reconcile');
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
      const { usedBytes } = (await res.json()) as Usage;

      const canonical = await withSql(async (sql) => {
        const [row] = await sql`
          select coalesce(sum(size), 0) as total from files
          where workspace_id = ${seeded.workspaceId}::uuid
        `;
        return Number((row as { total: string | number }).total);
      });
      expect(usedBytes).toBe(canonical);
      expect((await getUsage(page)).usedBytes).toBe(canonical);
    } finally {
      await restoreQuota(seeded.workspaceId, snap);
    }
  });

  test('limit change takes effect on the next upload — no restart', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const mark = stamp();
    const snap = await captureQuota(seeded.workspaceId);
    try {
      const before = await getUsage(page);
      // Cap exactly at current usage: any upload is over budget.
      expect((await patchLimit(page, before.usedBytes)).status()).toBe(200);
      expect((await upload(page, `${mark}-blocked.txt`, 8 * KB)).status()).toBe(413);

      // Raise the cap; the previously-rejected upload now succeeds without any
      // process restart (checkStorageQuota reads the row per request).
      expect((await patchLimit(page, before.usedBytes + 32 * KB)).status()).toBe(200);
      const retry = await upload(page, `${mark}-blocked.txt`, 8 * KB);
      expect(retry.status(), await retry.text().catch(() => '')).toBe(201);
      expect((await getUsage(page)).usedBytes).toBe(before.usedBytes + 8 * KB);
    } finally {
      await cleanupFiles(seeded.workspaceId, mark);
      await restoreQuota(seeded.workspaceId, snap);
    }
  });

  test('roles: editor and viewer can read usage but cannot set the limit; member meter renders', async ({
    browser,
    page,
    seeded,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    await signIn(page, seeded);
    const snap = await captureQuota(seeded.workspaceId);
    try {
      // Second user (default role: editor).
      const editor = await seedSecondUser(databaseUrl, { workspaceId: seeded.workspaceId });
      const { context, page: editorPage } = await signInSecondUser(browser, editor);
      try {
        const usageRes = await editorPage.request.get('/api/storage/usage');
        expect(usageRes.status()).toBe(200);
        const patchRes = await editorPage.request.patch('/api/admin/storage-quota', {
          data: { limitBytes: 1024 },
        });
        expect(patchRes.status()).toBe(403);

        // Member-visible meter: the /settings landing redirects every member
        // to /settings/account/profile, which hosts the read-only card.
        await editorPage.goto('/settings');
        await expect(editorPage.getByTestId('storage-usage-card')).toBeVisible({
          timeout: 15_000,
        });
        await expect(editorPage.getByTestId('storage-usage-summary')).toBeVisible();
      } finally {
        await context.close();
      }

      // Viewer: same read access, same admin 403.
      const viewer = await seedSecondUser(databaseUrl, {
        workspaceId: seeded.workspaceId,
        email: 'd6-viewer@cairn.test',
        password: 'd6-viewer-password-1',
        role: 'viewer',
      });
      const { context: viewerCtx, page: viewerPage } = await signInSecondUser(browser, viewer);
      try {
        expect((await viewerPage.request.get('/api/storage/usage')).status()).toBe(200);
        expect(
          (
            await viewerPage.request.patch('/api/admin/storage-quota', {
              data: { limitBytes: 1024 },
            })
          ).status(),
        ).toBe(403);
      } finally {
        await viewerCtx.close();
      }

      // The seeded owner gets the full admin console: meter card + controls.
      await page.goto('/settings/admin/storage');
      await expect(page.getByTestId('storage-usage-card')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('storage-set-limit')).toBeVisible();
      await expect(page.getByTestId('storage-clear-limit')).toBeVisible();
      await expect(page.getByTestId('storage-reconcile')).toBeVisible();
    } finally {
      await restoreQuota(seeded.workspaceId, snap);
    }
  });

  test('UI meter: used/limit copy renders and Reconcile now reports success', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const snap = await captureQuota(seeded.workspaceId);
    try {
      // A concrete limit makes the percentage bar (role="meter") render.
      const before = await getUsage(page);
      const limit = before.usedBytes + 1024 * KB;
      expect((await patchLimit(page, limit)).status()).toBe(200);

      await page.goto('/settings/admin/storage');
      const meter = page.getByTestId('storage-usage-meter');
      await expect(meter).toBeVisible({ timeout: 15_000 });
      await expect(meter).toHaveAttribute('role', 'meter');
      await expect(page.getByTestId('storage-usage-summary')).toContainText(
        `of ${formatBytes(limit)} used`,
      );

      await page.getByTestId('storage-reconcile').click();
      await expect(page.getByTestId('storage-notice')).toContainText(
        'Usage recounted from stored files.',
        { timeout: 15_000 },
      );
    } finally {
      await restoreQuota(seeded.workspaceId, snap);
    }
  });
});
