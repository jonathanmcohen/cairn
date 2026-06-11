import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { listBackupBundles } from '@/lib/backups/list';
import {
  getBackupSchedule,
  listRecentBackupRuns,
  parseBackupCommand,
} from '@/lib/backups/schedule';
import { env } from '@/lib/env';
import { BackupsView } from './backups-view';
import { ScheduleSection } from './schedule-section';

export const dynamic = 'force-dynamic';

// v0.10.0 C1 — settings-hub home for instance backup snapshots. The backup
// engine itself is the CLI (src/server/cli.ts `backup`); this page lists the
// bundles in CAIRN_BACKUP_DIR and offers a "create snapshot now" button so
// operators no longer need shell access for an ad-hoc backup. The RSC gates +
// reads the directory; <BackupsView/> renders the i18n copy and drives the
// create/poll/refresh loop.
//
// v0.10.0 C3 — <ScheduleSection/> below manages THE single scheduled-backup
// cron row + renders the durable backup_runs history. The RSC reads both
// server-side (and the CAIRN_SCHEDULER_ENABLED flag, same process.env read as
// the scheduler boot) so the scheduler-off warning renders without a client
// fetch.
export default async function BackupsSettingsPage() {
  await requireRole('admin');
  const bundles = await listBackupBundles(env().CAIRN_BACKUP_DIR);
  const db = getDb();
  const [schedule, runs] = await Promise.all([getBackupSchedule(db), listRecentBackupRuns(db, 20)]);

  return (
    <section className="space-y-8">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Backups"
      />
      <BackupsView bundles={bundles} />
      <ScheduleSection
        schedule={
          schedule
            ? {
                cronSpec: schedule.cronSpec,
                enabled: schedule.enabled,
                command: schedule.command,
                nextRunAt: schedule.nextRunAt.toISOString(),
                lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
                lastStatus: schedule.lastStatus,
                lastError: schedule.lastError,
                ...parseBackupCommand(schedule.command),
              }
            : null
        }
        schedulerEnabled={process.env.CAIRN_SCHEDULER_ENABLED === '1'}
        runs={runs.map((run) => ({
          id: run.id,
          startedAt: run.startedAt.toISOString(),
          status: run.status,
          trigger: run.trigger,
          durationMs: run.durationMs,
          bundleTs: run.bundleTs,
          error: run.error,
        }))}
      />
    </section>
  );
}
