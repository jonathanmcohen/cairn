import type { Route } from 'next';
import Link from 'next/link';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { Button } from '@/components/ui/button';
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
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Members</h1>
        <Button asChild variant="outline">
          <Link href="/settings/workspace/invites">Invite member</Link>
        </Button>
      </div>
      <MembersTable workspaceId={ctx.workspaceId} members={members} currentUserId={ctx.userId} />
    </section>
  );
}
