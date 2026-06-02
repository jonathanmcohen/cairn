import type { Route } from 'next';
import { InvitesManager } from '@/app/(app)/settings/workspace/invites/invites-manager';
import { MembersTable } from '@/app/(app)/settings/workspace/members/members-table';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { listWorkspaceMembers } from '@/lib/workspaces/admin-members';
import { listPendingInvites } from '@/lib/workspaces/invites';
import { UsersHeader } from './users-header';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const ctx = await requireRole('admin');
  const db = getDb();
  const members = await listWorkspaceMembers(db, ctx.workspaceId);
  const invites = await listPendingInvites(db, ctx.workspaceId);
  return (
    <section className="space-y-8">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin/audit' as Route }}
        page="Users"
      />
      <UsersHeader />

      <InvitesManager
        workspaceId={ctx.workspaceId}
        invites={invites.map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          token: inv.token,
          expiresAt: inv.expiresAt.toISOString(),
          createdAt: inv.createdAt.toISOString(),
        }))}
      />

      <MembersTable workspaceId={ctx.workspaceId} members={members} currentUserId={ctx.userId} />
    </section>
  );
}
