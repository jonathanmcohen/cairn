import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { listPendingInvites } from '@/lib/workspaces/invites';
import { InviteMemberDialog } from './invite-member-dialog';
import { InvitesManager } from './invites-manager';

export default async function AdminInvitesPage() {
  const ctx = await requireRole('admin');
  const invites = await listPendingInvites(getDb(), ctx.workspaceId);
  // Drop the raw `Date` objects → ISO strings for the client component boundary.
  const serialized = invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    token: i.token,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  }));
  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page="Invites"
      />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Invites</h1>
        <InviteMemberDialog workspaceId={ctx.workspaceId} />
      </div>
      <InvitesManager workspaceId={ctx.workspaceId} invites={serialized} />
    </section>
  );
}
