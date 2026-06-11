// v0.10.0 C3 — scheduled backups (/api/admin/backups/schedule + the
// "Scheduled backups" section of /settings/admin/backups).
//
// LAYERS: the schedule endpoint only writes a cron_schedules row — the cron
// tick itself is the v0.7 scheduler spawning `node dist/server/cli.js backup
// …`, which is EXACTLY the same CLI path the C1 create-now button spawns. So
// the history assertions here drive create-now (deterministic, no waiting on
// a cron tick) and still pin the same backup_runs write path a scheduled run
// takes. The advisory-lock contention + run-history details are unit-covered
// in tests/lib/backups-run-history.test.ts.
//
// The booted e2e server does NOT set CAIRN_SCHEDULER_ENABLED
// (playwright.e2e.config.ts), which doubles as the fixture for the
// scheduler-off warning assertion below.
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

type ScheduleJson = {
  schedule: { command: string; cronSpec: string; enabled: boolean } | null;
  schedulerEnabled: boolean;
  runs: { status: string; trigger: string; bundleTs: string | null }[];
};

test.describe('item C3 — scheduled backups', () => {
  test('PUT upserts the schedule; GET returns it with --out baked in; DELETE removes it', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    const put = await page.request.put('/api/admin/backups/schedule', {
      data: {
        enabled: true,
        cronSpec: '0 3 * * *',
        target: 'local',
        retentionDays: 14,
        keep: 5,
      },
    });
    expect(put.status(), await put.text()).toBe(200);
    const putBody = (await put.json()) as { schedule: { command: string } };
    // The audit trap pinned: the SERVER builds the command and always
    // includes --out (a stored backup command without it throws every tick).
    expect(putBody.schedule.command).toContain('--out ');
    expect(putBody.schedule.command).toContain('--trigger scheduled');

    const get = await page.request.get('/api/admin/backups/schedule');
    expect(get.status()).toBe(200);
    const body = (await get.json()) as ScheduleJson;
    expect(body.schedule).not.toBeNull();
    expect(body.schedule?.command).toContain('--out ');
    expect(body.schedule?.command).toContain('--retention-days 14');
    expect(body.schedule?.command).toContain('--keep 5');
    expect(body.schedule?.cronSpec).toBe('0 3 * * *');
    expect(body.schedule?.enabled).toBe(true);

    // A second PUT updates THE row (single schedule), not a duplicate.
    const rePut = await page.request.put('/api/admin/backups/schedule', {
      data: { enabled: false, cronSpec: '0 3 * * 0', target: 'local' },
    });
    expect(rePut.status()).toBe(200);
    const after = (await (
      await page.request.get('/api/admin/backups/schedule')
    ).json()) as ScheduleJson;
    expect(after.schedule?.cronSpec).toBe('0 3 * * 0');
    expect(after.schedule?.enabled).toBe(false);

    const del = await page.request.delete('/api/admin/backups/schedule');
    expect(del.status()).toBe(200);
    const gone = (await (
      await page.request.get('/api/admin/backups/schedule')
    ).json()) as ScheduleJson;
    expect(gone.schedule).toBeNull();
  });

  test('editor role gets 403 on PUT', async ({ browser, seeded }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');
    const second = await seedSecondUser(databaseUrl, { workspaceId: seeded.workspaceId });
    const { context, page } = await signInSecondUser(browser, second);
    try {
      const put = await page.request.put('/api/admin/backups/schedule', {
        data: { enabled: true, cronSpec: '0 3 * * *', target: 'local' },
      });
      expect(put.status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  test('invalid cron spec answers 400', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const put = await page.request.put('/api/admin/backups/schedule', {
      data: { enabled: true, cronSpec: 'not a cron', target: 'local' },
    });
    expect(put.status()).toBe(400);
    const body = (await put.json()) as { error?: string };
    expect(body.error).toBe('invalid-cron-spec');
  });

  test('history: two create-now backups produce done/manual backup_runs rows', async ({
    page,
    seeded,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, seeded);

    // Two SEQUENTIAL create-now runs (concurrent ones would contend on the
    // advisory lock by design — that path is unit-covered).
    for (let i = 0; i < 2; i++) {
      const post = await page.request.post('/api/admin/backups');
      expect(post.status(), await post.text()).toBe(202);
      const { jobId } = (await post.json()) as { jobId: string };
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
    }

    const res = await page.request.get('/api/admin/backups/schedule');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ScheduleJson;
    // ≥ 2: the persistent e2e dev DB may carry rows from earlier specs/runs.
    const doneManual = body.runs.filter((r) => r.status === 'done' && r.trigger === 'manual');
    expect(doneManual.length).toBeGreaterThanOrEqual(2);
    expect(doneManual[0]?.bundleTs).toBeTruthy();
  });

  test('scheduler-disabled warning renders (harness runs without CAIRN_SCHEDULER_ENABLED)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/settings/admin/backups');
    const warning = page.getByTestId('scheduler-disabled-warning');
    await expect(warning).toBeVisible({ timeout: 15_000 });
    // Pin the en copy so a key rename can't silently blank the warning.
    await expect(warning).toContainText('schedules will never fire');
  });
});
