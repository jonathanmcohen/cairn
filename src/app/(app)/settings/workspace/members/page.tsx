import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { listWorkspaceMembers } from '@/lib/workspaces/admin-members';
import { MembersTable } from './members-table';

export default async function AdminMembersPage() {
  const ctx = await requireRole('admin');
  const members = await listWorkspaceMembers(getDb(), ctx.workspaceId);
  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page="Members"
      />
      <h1 className="mb-4 text-xl font-semibold">Members</h1>
      <MembersTable workspaceId={ctx.workspaceId} members={members} currentUserId={ctx.userId} />
    </section>
  );
}
