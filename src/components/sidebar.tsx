import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { listUserWorkspaces } from '@/lib/workspaces/list';
import { SidebarContent } from './sidebar-content';
import { SidebarResizeHandle } from './sidebar-resize-handle';

// Exported so the shell contract is unit-testable without rendering the async
// server component. md:sticky + top-0 + self-start pins the aside to the
// viewport top so it stays in view while <main> scrolls (#207). On mobile the
// off-canvas SidebarDrawer owns layout; this aside is hidden.
export const SIDEBAR_ASIDE_CLASS =
  'relative hidden h-screen shrink-0 flex-col border-r border-border bg-card text-card-foreground md:sticky md:top-0 md:flex md:self-start';

export async function Sidebar({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const ctx = await getAuthContext();
  const workspaces = ctx ? await listUserWorkspaces(db, ctx.userId) : [];

  return (
    // P19 #42 — width is driven by the `--cairn-sidebar-w` CSS var (set by
    // SidebarResizeHandle from localStorage on the client), falling back to
    // 14rem (= 224px, #131; was 16rem/256) before hydration. Users who dragged
    // a width keep their persisted value; only the pre-hydration / never-resized
    // default changes. `relative` anchors the handle.
    <aside
      data-cairn-workspace-sidebar=""
      aria-label="Workspace sidebar"
      style={{ width: 'var(--cairn-sidebar-w, 14rem)' }}
      className={SIDEBAR_ASIDE_CLASS}
    >
      <SidebarContent workspaceId={workspaceId} workspaces={workspaces} />
      <SidebarResizeHandle storageKey="cairn:sidebar-width" />
    </aside>
  );
}
