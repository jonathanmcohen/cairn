import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { requireRole } from '@/lib/auth/require-role';
import { listBackupBundles } from '@/lib/backups/list';
import { env } from '@/lib/env';
import { BackupsView } from './backups-view';

export const dynamic = 'force-dynamic';

// v0.10.0 C1 — settings-hub home for instance backup snapshots. The backup
// engine itself is the CLI (src/server/cli.ts `backup`); this page lists the
// bundles in CAIRN_BACKUP_DIR and offers a "create snapshot now" button so
// operators no longer need shell access for an ad-hoc backup. The RSC gates +
// reads the directory; <BackupsView/> renders the i18n copy and drives the
// create/poll/refresh loop.
export default async function BackupsSettingsPage() {
  await requireRole('admin');
  const bundles = await listBackupBundles(env().CAIRN_BACKUP_DIR);

  return (
    <section className="space-y-8">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Backups"
      />
      <BackupsView bundles={bundles} />
    </section>
  );
}
