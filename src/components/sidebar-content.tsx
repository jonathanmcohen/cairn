import { LayoutTemplate, Trash } from 'lucide-react';
import Link from 'next/link';
import { appVersion } from '@/lib/version';
import type { UserWorkspace } from '@/lib/workspaces/list';
import { NewPageButton } from './new-page-button';
import { NotificationBell } from './notifications/bell';
import { SidebarTree } from './sidebar-tree';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { WorkspaceSwitcher } from './workspace-switcher';

/**
 * Presentational sidebar body shared by the desktop `<aside>` and the mobile
 * off-canvas drawer. Layout chrome (width/border/height) lives in each wrapper;
 * this body just fills its container.
 */
export function SidebarContent({
  workspaceId,
  workspaces,
}: {
  workspaceId: string;
  workspaces: UserWorkspace[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b p-2">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher workspaces={workspaces} activeId={workspaceId} />
        </div>
        <NotificationBell />
        <ThemeToggle />
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pages</p>
          <NewPageButton />
        </div>
        <SidebarTree workspaceId={workspaceId} />
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        <Link
          href="/templates"
          className="mb-2 flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <LayoutTemplate className="h-3 w-3" />
          Templates
        </Link>
        <Link
          href="/trash"
          className="mb-2 flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <Trash className="h-3 w-3" />
          Trash
        </Link>
        <form action="/api/auth/signout" method="post">
          <Button variant="ghost" size="sm" className="w-full justify-start" type="submit">
            Sign out
          </Button>
        </form>
        <div className="mt-2 text-center">v{appVersion()}</div>
      </div>
    </div>
  );
}
