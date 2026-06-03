import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { flattenedPageTree } from '@/lib/pages/tree';
import { listFavorites, listRecents } from '@/lib/prefs/user-page-prefs';
import { appVersion } from '@/lib/version';
import type { UserWorkspace } from '@/lib/workspaces/list';
import { SearchHintButton } from './search-hint-button';
import { PagesSection } from './sidebar/pages-section';
import { PinnedSection } from './sidebar/pinned-section';
import { SavedSearches } from './sidebar/saved-searches';
import { SidebarFavorites } from './sidebar-favorites';
import { SidebarFooterNav } from './sidebar-footer-nav';
import { SidebarRecents } from './sidebar-recents';
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
      <div className="border-b p-2">
        <WorkspaceSwitcher workspaces={workspaces} activeId={workspaceId} />
      </div>
      {/*
        v0.9.9 C3 (#209) — the <nav> is now a flex column. The upper sections
        (search/pinned/favorites/recents/saved-searches) are fixed-height; the
        PagesSection below is flex-grown and owns the SOLE scroll container
        (the tree's overflow-y-auto wrapper). Previously the whole <nav> was
        the scroll container, so everything scrolled together.
      */}
      <nav aria-labelledby="sidebar-pages-heading" className="flex min-h-0 flex-1 flex-col p-3">
        <SearchHintButton />
        <PinnedSection />
        <SidebarFavorites favorites={favorites} />
        <SidebarRecents recents={recents} />
        <SavedSearches />
        <PagesSection tree={tree} />
      </nav>
      <SidebarFooterNav version={appVersion()} />
    </div>
  );
}
