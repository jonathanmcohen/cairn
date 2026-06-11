import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { flattenedPageTree } from '@/lib/pages/tree';
import { listFavorites, listRecents } from '@/lib/prefs/user-page-prefs';
import { appVersion } from '@/lib/version';
import { getWorkspaceBrand } from '@/lib/workspaces/brand';
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
  // v0.10.0 F1 — brand logo (larger than the icon) above the switcher. Signed
  // URL, 1 h TTL; absent → nothing renders, the header keeps today's layout.
  const brand = await getWorkspaceBrand(getDb(), workspaceId, { secret: env().AUTH_SECRET });
  const activeName =
    workspaces.find((w) => w.id === workspaceId)?.name ?? workspaces[0]?.name ?? '';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-1">
        {brand.logoUrl ? (
          // biome-ignore lint/performance/noImgElement: HMAC-signed expiring URL — bypasses next/image loader
          <img
            data-cairn-brand-logo=""
            src={brand.logoUrl}
            alt={activeName}
            className="mx-2 mt-1 max-h-10 w-auto max-w-[85%] object-contain"
          />
        ) : null}
        <WorkspaceSwitcher workspaces={workspaces} activeId={workspaceId} />
      </div>
      {/*
        v0.9.9 C3 (#209) — the <nav> is a flex column; PagesSection is
        flex-grown and owns the page tree's scroll container. v0.10.0 H3: the
        upper sections (search/pinned/favorites/recents/saved-searches) are
        now capped as a GROUP at 45% of the nav with their own scrollbar —
        unbounded, at laptop-height viewports with favorites/recents at cap
        they consumed the whole nav and the PAGES tree rendered with ZERO
        height (the H3 runtime-px guard found it: the virtualizer's scroll
        container measured 0 and no rows mounted at all).
      */}
      <nav aria-labelledby="sidebar-pages-heading" className="flex min-h-0 flex-1 flex-col p-1.5">
        <div className="max-h-[45%] shrink-0 overflow-y-auto cairn-thin-scrollbar">
          <SearchHintButton />
          <PinnedSection />
          <SidebarFavorites favorites={favorites} />
          <SidebarRecents recents={recents} />
          <SavedSearches />
        </div>
        <PagesSection tree={tree} />
      </nav>
      <SidebarFooterNav version={appVersion()} />
    </div>
  );
}
