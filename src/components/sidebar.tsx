import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { listUserWorkspaces } from '@/lib/workspaces/list';
import { SidebarContent } from './sidebar-content';

export async function Sidebar({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const ctx = await getAuthContext();
  const workspaces = ctx ? await listUserWorkspaces(db, ctx.userId) : [];

  return (
    <aside
      data-cairn-workspace-sidebar=""
      aria-label="Workspace sidebar"
      className="hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card text-card-foreground md:flex"
    >
      <SidebarContent workspaceId={workspaceId} workspaces={workspaces} />
    </aside>
  );
}
