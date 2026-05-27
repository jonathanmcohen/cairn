import { CheckSquare, LayoutTemplate, Trash } from 'lucide-react';
import Link from 'next/link';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { flattenedPageTree } from '@/lib/pages/tree';
import { listFavorites, listRecents } from '@/lib/prefs/user-page-prefs';
import { appVersion } from '@/lib/version';
import type { UserWorkspace } from '@/lib/workspaces/list';
import { NewPageButton } from './new-page-button';
import { PinnedSection } from './sidebar/pinned-section';
import { ReviewDueCounter } from './sidebar/review-due-counter';
import { SavedSearches } from './sidebar/saved-searches';
import { VirtualizedPageTree } from './sidebar/virtualized-page-tree';
import { SidebarFavorites } from './sidebar-favorites';
import { SidebarRecents } from './sidebar-recents';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { WorkspaceSwitcher } from './workspace-switcher';

/**
 * Presentational sidebar body shared by the desktop `<aside>` and the mobile
 * off-canvas drawer. Layout chrome (width/border/height) lives in each wrapper;
 * this body just fills its container.
 */
export async function SidebarContent({
  workspaceId,
  workspaces,
}: {
  workspaceId: string;
  workspaces: UserWorkspace[];
}) {
  const ctx = await getAuthContext();
  const favorites = ctx ? await listFavorites(getDb(), { userId: ctx.userId, workspaceId }) : [];
  const recents = ctx ? await listRecents(getDb(), { userId: ctx.userId, workspaceId }) : [];
  // Server-side flatten so the client renders a windowed flat list (P4); the
  // recursive shape is gone — depth annotation handles indentation visually.
  // v0.9.0 G4 P26 — pass viewer so the lister can show drafts to their author
  // and hide archived from everyone.
  const tree = await flattenedPageTree(getDb(), workspaceId, ctx?.userId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b p-2">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher workspaces={workspaces} activeId={workspaceId} />
        </div>
        <ThemeToggle />
      </div>
      <nav aria-labelledby="sidebar-pages-heading" className="flex-1 overflow-y-auto p-3">
        <PinnedSection />
        <SidebarFavorites favorites={favorites} />
        <SidebarRecents recents={recents} />
        <SavedSearches />
        <div className="mb-2 flex items-center justify-between px-2">
          <p
            id="sidebar-pages-heading"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Pages
          </p>
          <NewPageButton />
        </div>
        <VirtualizedPageTree initial={tree} />
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        <ReviewDueCounter />
        <Link
          href="/my-tasks"
          className="mb-2 flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <CheckSquare aria-hidden="true" className="h-3 w-3" />
          My tasks
        </Link>
        <Link
          href="/templates"
          className="mb-2 flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <LayoutTemplate aria-hidden="true" className="h-3 w-3" />
          Templates
        </Link>
        <Link
          href="/trash"
          className="mb-2 flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <Trash aria-hidden="true" className="h-3 w-3" />
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
