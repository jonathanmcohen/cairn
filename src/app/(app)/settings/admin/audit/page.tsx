import { AuditViewer } from '@/components/admin/audit-viewer';
import { requireRole } from '@/lib/auth/require-role';

// Server-component gate for the admin audit-log viewer. The shell layout in
// `/settings/admin/layout.tsx` already redirects below-admin out of the group,
// but we re-call `requireRole('admin')` here so a direct URL hit can't render
// the page if a deploy ever drifted the layout gate.
export default async function AuditLogPage() {
  await requireRole('admin');
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">Audit log</h1>
      <AuditViewer />
    </section>
  );
}
