import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { SystemHealthPanel } from '@/components/settings/system-health-panel';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { getSystemHealth } from '@/lib/health/system-health';

/**
 * v0.10.3 CFG-4 — admin-scoped System health dashboard.
 *
 * Server Component. Gates on `requireRole('admin')`. Aggregates every
 * instance-level "disabled / degraded / configured" indicator (email, object
 * storage, scheduler, collab bridge, E2E encryption) into one read-only list of
 * status pills, each with a Fix link to the relevant settings page. Distinct
 * from the readiness-probe panel at /settings/admin/health.
 */
export default async function AdminSystemHealthPage() {
  await requireRole('admin');
  const { pills } = await getSystemHealth(getDb());

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="System health"
      />
      <h1 className="mb-2 font-semibold text-xl">System health</h1>
      <p className="mb-4 text-muted-foreground text-sm">
        A one-glance summary of which instance services are configured, degraded, or off. Each row
        links to the settings page where you can fix it. This page is read-only and never shows
        secrets.
      </p>
      <SystemHealthPanel pills={pills} />
    </section>
  );
}
