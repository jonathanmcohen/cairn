import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { requireRole } from '@/lib/auth/require-role';
import { getHealthSnapshot } from '@/lib/health/panel';
import { HealthView } from './health-view';

export const dynamic = 'force-dynamic';

// v0.10.0 D4 — settings-hub home for instance health/readiness. The RSC gates
// (admin/owner) and runs the server-side probes (src/lib/health/panel.ts):
// db reachability, bundled app version, per-replica uptime, and the A4
// collab-bridge configured/connected signal (previously surfaced only on the
// upgrade page, which admins rarely visit). <HealthView/> renders the i18n
// copy; its Refresh button re-runs this RSC via router.refresh().
//
// This panel only READS. /healthz stays the machine probe (503 on db-down);
// /api/health keeps its always-200 body-only contract — changing that
// status-code behavior belongs to item H4d, not D4.
export default async function HealthSettingsPage() {
  await requireRole('admin');
  const snapshot = await getHealthSnapshot();

  return (
    <section className="space-y-6">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Health"
      />
      <HealthView snapshot={snapshot} />
    </section>
  );
}
