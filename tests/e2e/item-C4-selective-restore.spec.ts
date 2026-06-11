// v0.10.0 C4 — selective restore (additive, scratch-database pipeline).
//
// Runs against the booted standalone server (playwright.e2e.config.ts), which
// has CAIRN_BACKUP_DIR=.e2e-backups and pg_dump/pg_restore on PATH. The spec
// is self-contained: it snapshots its OWN seed (pages A + child B), proves
// non-destructiveness with a post-snapshot marker page C, restores A's
// subtree from the snapshot into the same workspace, and asserts the restored
// copies are NEW pages with the parent chain remapped while every original
// (including C) is untouched. The scratch DB `cairn_restore_*` lives on the
// same Postgres instance; its lifecycle is covered implicitly — a leaked
// scratch DB would fail the NEXT restore's CREATE DATABASE only after 1 h, so
// the falsifiable signal here is the restore succeeding end-to-end twice
// (job + failed-source job) in one run.
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';
import { createPageViaApi, openPageEditor, pmDoc, pmParagraph } from './util';

type Job = {
  status: string;
  error?: string;
  result?: { pagesRestored: number; rowsRestored: number; skippedFiles: number };
};

type TreeNode = { id: string; parentId: string | null; title: string };

async function pollJobDone(page: import('@playwright/test').Page, jobId: string): Promise<Job> {
  let last: Job = { status: 'running' };
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/admin/backups/jobs/${jobId}`);
        if (!res.ok()) return `transient-${res.status()}`;
        last = (await res.json()) as Job;
        if (last.status === 'failed') {
          throw new Error(`job failed: ${last.error ?? 'no error detail'}`);
        }
        return last.status;
      },
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBe('done');
  return last;
}

test.describe('item C4 — selective restore', () => {
  test('page-subtree restore: additive, remapped parent chain, content renders', async ({
    page,
    seeded,
  }) => {
    // pg_dump + pg_restore into a scratch DB + two poll loops on CI boxes.
    test.setTimeout(300_000);
    await signIn(page, seeded);

    const stamp = Date.now();
    const markerA = `c4markerA${stamp}`;
    const markerB = `c4markerB${stamp}`;
    const titleA = `C4 source root ${stamp}`;
    const titleB = `C4 source child ${stamp}`;

    // 1. Seed: page A with child page B (POST /api/pages supports parentId),
    // each carrying a distinctive marker paragraph.
    const pageAId = await createPageViaApi(page, titleA, pmDoc(pmParagraph(markerA)));
    const createdB = await page.request.post('/api/pages', {
      data: { title: titleB, parentId: pageAId },
    });
    expect(createdB.ok(), await createdB.text()).toBe(true);
    const { id: pageBId } = (await createdB.json()) as { id: string };
    const patchedB = await page.request.patch(`/api/pages/${pageBId}`, {
      data: { content: pmDoc(pmParagraph(markerB)) },
    });
    expect(patchedB.ok(), await patchedB.text()).toBe(true);

    // 2. Snapshot via the C1 route (self-contained — no cross-file deps).
    const snap = await page.request.post('/api/admin/backups');
    expect(snap.status(), await snap.text()).toBe(202);
    const { jobId: snapJobId } = (await snap.json()) as { jobId: string };
    await pollJobDone(page, snapJobId);

    const list = await page.request.get('/api/admin/backups');
    expect(list.status()).toBe(200);
    const bundles = (await list.json()) as { ts: string }[];
    const newest = bundles[0];
    if (!newest) throw new Error('bundle list empty after a done backup job');

    // 3. Post-snapshot marker page C — must survive the restore untouched
    // (the additive proof: a destructive restore would erase it).
    const titleC = `C4 post-snapshot marker ${stamp}`;
    const pageCId = await createPageViaApi(page, titleC);

    // 4. Selective restore of A's subtree into the SAME workspace.
    const start = await page.request.post('/api/admin/backups/selective-restore', {
      data: {
        ts: newest.ts,
        mode: 'page',
        sourcePageId: pageAId,
        targetWorkspaceId: seeded.workspaceId,
        confirm: true,
      },
    });
    expect(start.status(), await start.text()).toBe(202);
    const { jobId } = (await start.json()) as { jobId: string };
    const job = await pollJobDone(page, jobId);
    expect(job.result?.pagesRestored).toBe(2);
    expect(job.result?.skippedFiles).toBe(0);

    // 5. The tree now holds the originals AND the restored copies under NEW
    // ids, with restored B parented to restored A (remap proof).
    const treeRes = await page.request.get('/api/pages/tree');
    expect(treeRes.status()).toBe(200);
    const { nodes } = (await treeRes.json()) as { nodes: TreeNode[] };

    const originalA = nodes.find((n) => n.id === pageAId);
    const originalB = nodes.find((n) => n.id === pageBId);
    expect(originalA, 'original A untouched').toBeTruthy();
    expect(originalB?.parentId).toBe(pageAId);

    const restoredA = nodes.find((n) => n.title === titleA && n.id !== pageAId);
    const restoredB = nodes.find((n) => n.title === titleB && n.id !== pageBId);
    expect(restoredA, 'restored copy of A exists under a new id').toBeTruthy();
    expect(restoredB, 'restored copy of B exists under a new id').toBeTruthy();
    if (!restoredA || !restoredB) throw new Error('unreachable');
    // Restored root is a TOP-LEVEL page (its snapshot parent was outside the
    // restored set... A had no parent, so null either way), and restored B
    // hangs off restored A — not off the original A.
    expect(restoredA.parentId).toBeNull();
    expect(restoredB.parentId).toBe(restoredA.id);

    // Page C still exists (additive proof).
    expect(
      nodes.find((n) => n.id === pageCId),
      'marker page C survived',
    ).toBeTruthy();

    // 6. Open restored A in the live editor: the marker renders, proving the
    // content remap + regenerated page_yjs state feed the collab editor.
    await openPageEditor(page, restoredA.id, markerA);
  });

  test('editor role gets 403; unknown source page fails the job with a clear error', async ({
    page,
    browser,
    seeded,
  }) => {
    test.setTimeout(240_000);
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');

    // Role gate: seedSecondUser defaults to role 'editor' — below the gate.
    const second = await seedSecondUser(databaseUrl, { workspaceId: seeded.workspaceId });
    const { context, page: editorPage } = await signInSecondUser(browser, second);
    try {
      const res = await editorPage.request.post('/api/admin/backups/selective-restore', {
        data: {
          ts: 'whatever',
          mode: 'page',
          sourcePageId: '00000000-0000-0000-0000-000000000001',
          targetWorkspaceId: seeded.workspaceId,
          confirm: true,
        },
      });
      expect(res.status()).toBe(403);
    } finally {
      await context.close();
    }

    // Unknown source: take a fresh snapshot, then ask it for a page id that
    // never existed → the job runs and FAILS with a clear source error
    // (extraction happens inside the scratch DB, so this cannot 404 upfront).
    await signIn(page, seeded);
    const snap = await page.request.post('/api/admin/backups');
    expect(snap.status(), await snap.text()).toBe(202);
    const { jobId: snapJobId } = (await snap.json()) as { jobId: string };
    await pollJobDone(page, snapJobId);
    const list = await page.request.get('/api/admin/backups');
    const bundles = (await list.json()) as { ts: string }[];
    const newest = bundles[0];
    if (!newest) throw new Error('bundle list empty after a done backup job');

    const start = await page.request.post('/api/admin/backups/selective-restore', {
      data: {
        ts: newest.ts,
        mode: 'page',
        sourcePageId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        targetWorkspaceId: seeded.workspaceId,
        confirm: true,
      },
    });
    expect(start.status(), await start.text()).toBe(202);
    const { jobId } = (await start.json()) as { jobId: string };

    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/admin/backups/jobs/${jobId}`);
          if (!res.ok()) return `transient-${res.status()}`;
          const job = (await res.json()) as Job;
          return job.status;
        },
        { timeout: 120_000, intervals: [1_000] },
      )
      .toBe('failed');
    const jobRes = await page.request.get(`/api/admin/backups/jobs/${jobId}`);
    const job = (await jobRes.json()) as Job;
    expect(job.error ?? '').toMatch(/source page .* not found/i);

    // Missing bundle → upfront 404 (no doomed job).
    const missing = await page.request.post('/api/admin/backups/selective-restore', {
      data: {
        ts: 'no-such-bundle',
        mode: 'page',
        sourcePageId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        targetWorkspaceId: seeded.workspaceId,
        confirm: true,
      },
    });
    expect(missing.status()).toBe(404);
  });
});
