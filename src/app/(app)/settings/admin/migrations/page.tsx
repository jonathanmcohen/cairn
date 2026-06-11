import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import {
  getMigrationStatus,
  loadJournalFromPath,
  type MigrationStatus,
  resolveJournalPath,
} from '@/lib/upgrade/status';
import { MigrationsView } from './migrations-view';

export const dynamic = 'force-dynamic';

// v0.10.0 D7 — read-only migration status panel. The RSC gates (admin/owner,
// same posture as the sibling health page) and assembles the status server-
// side (src/lib/upgrade/status.ts): bundled journal vs the live
// drizzle.__drizzle_migrations table. <MigrationsView/> renders the i18n copy;
// its Refresh button re-runs this RSC via router.refresh().
//
// status === null means the journal could not be located on this deployment
// (resolveJournalPath probes cwd and ../../ for the standalone-server case) —
// the view renders a degraded notice instead of this RSC throwing.
//
// READ-ONLY by design: no retry button (v0.9.17 postmortem — duplicate-ALTER
// trap). Recovery guidance is copy, pointing at docs/operations.md.
export default async function MigrationsSettingsPage() {
  await requireRole('admin');

  const journalPath = resolveJournalPath();
  let status: MigrationStatus | null = null;
  if (journalPath) {
    const journal = await loadJournalFromPath(journalPath);
    status = await getMigrationStatus(getDb(), journal);
  }

  return (
    <section className="space-y-6">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Migrations"
      />
      <MigrationsView status={status} />
    </section>
  );
}
