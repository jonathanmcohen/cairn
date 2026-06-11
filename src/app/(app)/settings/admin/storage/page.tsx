import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { requireRole } from '@/lib/auth/require-role';
import { StorageView } from './storage-view';

export const dynamic = 'force-dynamic';

// v0.10.0 D6 — admin surface for the workspace storage quota. The RSC only
// gates (admin/owner — same posture as the sibling health page); all data
// flows through the client view's fetches so the meter, the limit editor and
// the reconcile button stay in sync without a page reload:
//   GET   /api/storage/usage                  — counters (viewer-gated)
//   PATCH /api/admin/storage-quota            — set/clear the limit
//   POST  /api/admin/storage-quota/reconcile  — recount from sum(files.size)
export default async function StorageSettingsPage() {
  await requireRole('admin');

  return (
    <section className="space-y-6">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Storage"
      />
      <StorageView />
    </section>
  );
}
