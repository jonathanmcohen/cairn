import type { Route } from 'next';
import { AuditViewer } from '@/components/admin/audit-viewer';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { requireRole } from '@/lib/auth/require-role';

// Server-component gate for the admin audit-log viewer. The sectioned settings
// hub's parent layout does not gate (any signed-in user can see /settings/*),
// so each admin-scoped page re-calls `requireRole('admin')` to enforce.
export default async function AuditLogPage() {
  await requireRole('admin');
  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Audit log"
      />
      <h1 className="mb-4 text-xl font-semibold">Audit log</h1>
      <AuditViewer />
    </section>
  );
}
