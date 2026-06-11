// v0.10.0 C2 — restore UI + app-wide read-only mode.
//
// Runs against the booted standalone server (playwright.e2e.config.ts), which
// gets CAIRN_BACKUP_DIR=.e2e-backups and pg_dump/pg_restore on PATH. The spec
// is self-contained: the roundtrip test creates its OWN snapshot via the C1
// POST instead of depending on bundles other spec files may have left behind.
//
// Branch coverage note: the "encrypted bundle while
// CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is unset → upfront 400" branch is
// covered at the UNIT layer (tests/lib/backups-restore.test.ts) instead of
// here — Playwright cannot write a fabricated `.enc` file into the booted
// server's filesystem, and the upload route's magic sniff (correctly) rejects
// a junk envelope, so there is no e2e-visible way to plant one.
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';
import { createPageViaApi } from './util';

type Job = { status: string; error?: string };

/**
 * Database name of the e2e harness DB. Mirrors parseDbUrl in
 * src/server/cli-internal.ts (the parser behind the route's confirm gate);
 * DATABASE_URL is in process.env because the Playwright config ran dotenv.
 */
function dbNameFromEnv(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

test.describe('item C2 — restore UI + read-only mode', () => {
  test('upload: junk .dump rejected 400; PGDMP-prefixed truncated file accepted', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    const junk = await page.request.post('/api/admin/backups/upload', {
      multipart: {
        file: {
          name: 'junk.dump',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from('this is not a postgres dump'),
        },
      },
    });
    expect(junk.status(), await junk.text()).toBe(400);

    // The sniff is magic-only: a truncated-but-PGDMP-prefixed body is the
    // restore job's (pg_restore's) problem, not the upload route's.
    const truncated = await page.request.post('/api/admin/backups/upload', {
      multipart: {
        file: {
          name: 'truncated.dump',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from('PGDMP\x01\x02 truncated archive'),
        },
      },
    });
    expect(truncated.status(), await truncated.text()).toBe(201);
    const { ts } = (await truncated.json()) as { ts: string };
    expect(ts).toContain('-uploaded');

    // The uploaded bundle (with its generated manifest) appears in the C1 list.
    const list = await page.request.get('/api/admin/backups');
    expect(list.status()).toBe(200);
    const bundles = (await list.json()) as { ts: string }[];
    expect(bundles.some((b) => b.ts === ts)).toBe(true);
  });

  test('editor role gets 403 on both restore POST and upload POST', async ({ browser, seeded }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    // seedSecondUser defaults to role 'editor' — below the admin gate.
    const second = await seedSecondUser(databaseUrl, { workspaceId: seeded.workspaceId });
    const { context, page } = await signInSecondUser(browser, second);
    try {
      const restore = await page.request.post('/api/admin/backups/restore', {
        data: { ts: 'whatever', confirmDatabase: 'whatever' },
      });
      expect(restore.status()).toBe(403);
      const upload = await page.request.post('/api/admin/backups/upload', {
        multipart: {
          file: {
            name: 'x.dump',
            mimeType: 'application/octet-stream',
            buffer: Buffer.from('PGDMP'),
          },
        },
      });
      expect(upload.status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  test('confirm gate: wrong confirmDatabase → 400 and the DB is untouched', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const res = await page.request.post('/api/admin/backups/restore', {
      data: { ts: 'no-bundle-needed-here', confirmDatabase: 'definitely-the-wrong-name' },
    });
    expect(res.status(), await res.text()).toBe(400);
    const body = (await res.json()) as { error?: string };
    // Non-leaky: the expected database name is never echoed back.
    expect(body.error).toBe('confirmation-mismatch');
    expect(JSON.stringify(body)).not.toContain(dbNameFromEnv());

    // Nothing was restored or gated: the seeded page still loads.
    const seededPage = await page.request.get(`/api/pages/${seeded.pageId}`);
    expect(seededPage.status()).toBe(200);
  });

  test('full roundtrip: snapshot → restore → 503 writes during → data intact after', async ({
    page,
    seeded,
  }) => {
    // pg_dump + pg_restore of the seeded DB + two poll loops on CI boxes.
    test.setTimeout(240_000);
    await signIn(page, seeded);

    // A marker created BEFORE the snapshot must exist again after the restore.
    const markerId = await createPageViaApi(page, `C2 pre-restore marker ${Date.now()}`);

    // 1. Snapshot via the C1 route (self-contained — no cross-file deps).
    const snap = await page.request.post('/api/admin/backups');
    expect(snap.status(), await snap.text()).toBe(202);
    const { jobId: snapJobId } = (await snap.json()) as { jobId: string };
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/admin/backups/jobs/${snapJobId}`);
          expect(res.status()).toBe(200);
          const job = (await res.json()) as Job;
          if (job.status === 'failed') {
            throw new Error(`backup job failed: ${job.error ?? 'no error detail'}`);
          }
          return job.status;
        },
        { timeout: 90_000, intervals: [1_000] },
      )
      .toBe('done');

    // 2. Newest bundle is the snapshot we just took.
    const list = await page.request.get('/api/admin/backups');
    expect(list.status()).toBe(200);
    const bundles = (await list.json()) as { ts: string }[];
    const newest = bundles[0];
    if (!newest) throw new Error('bundle list empty after a done backup job');

    // 3. Start the restore with the CORRECT database name.
    const restore = await page.request.post('/api/admin/backups/restore', {
      data: { ts: newest.ts, confirmDatabase: dbNameFromEnv() },
    });
    expect(restore.status(), await restore.text()).toBe(202);
    const { jobId } = (await restore.json()) as { jobId: string };

    // 4. Read-only window: a write issued immediately after the 202 must get
    // the proxy's 503 maintenance answer. The e2e DB is tiny, so tolerate the
    // race where the restore already finished — but if the write SUCCEEDED
    // while the job was still running, the gate is broken and we fail hard.
    const probe = await page.request.post('/api/pages', {
      data: { title: 'C2 during-restore write probe' },
    });
    if (probe.status() === 503) {
      const body = (await probe.json()) as { error?: string; reason?: string };
      expect(body.error).toBe('maintenance');
      expect(body.reason).toBe('restore');
    } else {
      const jobRes = await page.request.get(`/api/admin/backups/jobs/${jobId}`);
      const job = (await jobRes.json()) as Job;
      expect(
        ['done', 'failed'],
        `write got ${probe.status()} while the restore job was still ${job.status}`,
      ).toContain(job.status);
      console.log(
        `[item-C2] restore finished before the write probe (write got ${probe.status()}); soft-skipping the 503 assertion`,
      );
    }

    // 5. Poll the restore job to done. Transient non-200s are expected: the
    // status route's auth queries can hit tables pg_restore is rebuilding.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/admin/backups/jobs/${jobId}`);
          if (!res.ok()) return `transient-${res.status()}`;
          const job = (await res.json()) as Job;
          if (job.status === 'failed') {
            throw new Error(`restore job failed: ${job.error ?? 'no error detail'}`);
          }
          return job.status;
        },
        { timeout: 120_000, intervals: [1_000] },
      )
      .toBe('done');

    // 6. Maintenance is off: writes succeed again.
    await expect
      .poll(
        async () => {
          const write = await page.request.post('/api/pages', {
            data: { title: 'C2 post-restore write' },
          });
          return write.status();
        },
        { timeout: 30_000, intervals: [1_000] },
      )
      .toBe(201);

    // 7. Pre-snapshot data survived the roundtrip.
    const marker = await page.request.get(`/api/pages/${markerId}`);
    expect(marker.status()).toBe(200);
    const seededPage = await page.request.get(`/api/pages/${seeded.pageId}`);
    expect(seededPage.status()).toBe(200);
  });
});
