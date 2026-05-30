import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { listUserWorkspaces } from '@/lib/workspaces/list';
import { SidebarContent } from './sidebar-content';
import { SidebarResizeHandle } from './sidebar-resize-handle';

export async function Sidebar({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const ctx = await getAuthContext();
  const workspaces = ctx ? await listUserWorkspaces(db, ctx.userId) : [];

  return (
    // P19 #42 — width is driven by the `--cairn-sidebar-w` CSS var (set by
    // SidebarResizeHandle from localStorage on the client), falling back to
    // 16rem (= the old w-64) before hydration. `relative` anchors the handle.
    <aside
      data-cairn-workspace-sidebar=""
      aria-label="Workspace sidebar"
      style={{ width: 'var(--cairn-sidebar-w, 16rem)' }}
      className="relative hidden h-screen shrink-0 flex-col border-r border-border bg-card text-card-foreground md:flex"
    >
      <SidebarContent workspaceId={workspaceId} workspaces={workspaces} />
      <SidebarResizeHandle storageKey="cairn:sidebar-width" />
    </aside>
  );
}
