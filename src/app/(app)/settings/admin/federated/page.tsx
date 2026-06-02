import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { canFederate } from '@/app/(app)/search/can-federate';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { listPeers } from '@/lib/search/peer-admin';
import { FederatedManager } from './federated-manager';

export const dynamic = 'force-dynamic';

export default async function FederatedAdminPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  // Mirror the search route: cross-instance federation is admin/owner-only.
  if (!canFederate(ctx.role)) redirect('/settings/admin/audit');
  const peers = await listPeers(getDb(), ctx.workspaceId);
  return (
    <section className="space-y-6">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin/audit' as Route }}
        page="Federated search"
      />
      <FederatedManager peers={peers} />
    </section>
  );
}
