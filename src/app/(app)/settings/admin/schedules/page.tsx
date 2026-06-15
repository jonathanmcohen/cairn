import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { SchedulesManager } from '@/components/settings/schedules-manager';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { listSchedules } from '@/lib/scheduler/manage';

/**
 * v0.10.3 CFG-3 — admin-scoped cron Schedules console.
 *
 * Server Component. Gates on `requireRole('admin')`. Lists every
 * `cron_schedules` row (global + per-workspace) with an editable cron
 * expression, an enable/disable toggle, and a "Run now" button. Jobs only
 * actually run when the in-process scheduler is enabled
 * (CAIRN_SCHEDULER_ENABLED=1) — the manager carries that note.
 */
export default async function AdminSchedulesPage() {
  await requireRole('admin');
  const initial = await listSchedules(getDb());

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Schedules"
      />
      <h1 className="mb-2 font-semibold text-xl">Scheduled jobs</h1>
      <p className="mb-4 text-muted-foreground text-sm">
        Recurring background jobs (trash purge, page auto-unlock, notifications, and so on). Edit a
        job&rsquo;s cron expression, turn it on or off, or run it now. Changes take effect on the
        next scheduler tick.
      </p>
      <SchedulesManager initial={initial} />
    </section>
  );
}
