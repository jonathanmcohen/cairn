// v0.10.0 C1 — backup snapshot UI (/settings/admin/backups + /api/admin/backups).
//
// The booted standalone server gets CAIRN_BACKUP_DIR pointed at .e2e-backups/
// and pg_dump on PATH via playwright.e2e.config.ts (the libpq keg path is only
// prepended when it exists, so the Linux CI runner — pg_dump natively on PATH
// — is unaffected). The pg_dump-missing 503 path is covered at the unit layer
// (tests/lib/backups-jobs.test.ts) because the e2e harness cannot strip the
// booted server's PATH.
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

type BundleJson = { ts: string; encrypted: boolean; dumpBytes: number };

test.describe('item C1 — backup snapshot UI', () => {
  test('admin reaches the backups page via the settings sidebar', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/audit');
    await page.getByRole('link', { name: 'Backups' }).click();
    await page.waitForURL('**/settings/admin/backups');

    await expect(page.getByRole('heading', { name: 'Backups', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('backup-create-now')).toBeVisible();
    // Renders either the empty state or the bundle table — both are valid
    // (earlier runs against the persistent dev DB may have left bundles).
    const emptyOrTable = page
      .getByTestId('backups-empty')
      .or(page.getByTestId('backup-row').first());
    await expect(emptyOrTable).toBeVisible({ timeout: 15_000 });
  });

  test('GET /api/admin/backups answers 200 with an array for an admin', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.request.get('/api/admin/backups');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  test('editor role gets 403 on both GET and POST', async ({ browser, seeded }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    // seedSecondUser defaults to role 'editor' — below the admin gate.
    const second = await seedSecondUser(databaseUrl, { workspaceId: seeded.workspaceId });
    const { context, page } = await signInSecondUser(browser, second);
    try {
      const get = await page.request.get('/api/admin/backups');
      expect(get.status()).toBe(403);
      const post = await page.request.post('/api/admin/backups');
      expect(post.status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  test('create-now: POST → 202 jobId → poll to done → bundle appears in the list', async ({
    page,
    seeded,
  }) => {
    // pg_dump of the seeded DB + the poll loop can be slow on CI boxes.
    test.setTimeout(120_000);
    await signIn(page, seeded);

    const post = await page.request.post('/api/admin/backups');
    expect(post.status(), await post.text()).toBe(202);
    const { jobId } = (await post.json()) as { jobId: string };
    expect(typeof jobId).toBe('string');

    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/admin/backups/jobs/${jobId}`);
          expect(res.status()).toBe(200);
          const job = (await res.json()) as { status: string; error?: string };
          if (job.status === 'failed') {
            throw new Error(`backup job failed: ${job.error ?? 'no error detail'}`);
          }
          return job.status;
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toBe('done');

    const list = await page.request.get('/api/admin/backups');
    expect(list.status()).toBe(200);
    const bundles = (await list.json()) as BundleJson[];
    expect(bundles.length).toBeGreaterThanOrEqual(1);
    // Newest-first; the harness sets no CAIRN_BACKUP_ENCRYPTION_PASSPHRASE, so
    // the fresh bundle is unencrypted with a non-empty pg_dump archive.
    const newest = bundles[0];
    if (!newest) throw new Error('list returned an empty array after a done job');
    expect(newest.encrypted).toBe(false);
    expect(newest.dumpBytes).toBeGreaterThan(0);
  });
});
