import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { flattenedPageTree } from '@/lib/pages/tree';
import { listFavorites } from '@/lib/prefs/user-page-prefs';
import { appVersion } from '@/lib/version';
import { getWorkspaceBrand } from '@/lib/workspaces/brand';
import type { UserWorkspace } from '@/lib/workspaces/list';
import { SearchHintButton } from './search-hint-button';
import { PagesSection } from './sidebar/pages-section';
import { PinnedSection } from './sidebar/pinned-section';
import { SavedSearches } from './sidebar/saved-searches';
import { SidebarFooterNav } from './sidebar-footer-nav';
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
  // v0.10.2 S17 — favorites are no longer rendered as an upper-group section
  // (the standalone FAVORITES + RECENTS sections were removed; Favorites now
  // lives only as a footer row). The fetch is kept solely to feed the footer's
  // gold-star state via favoritesCount; RECENTS was removed entirely.
  const favorites = ctx ? await listFavorites(getDb(), { userId: ctx.userId, workspaceId }) : [];
  // v0.10.2 S11 — the sign-out confirm dialog names the account. The JWT
  // session only carries the user id (see auth/config.ts session callback), so
  // the email is read from the users record by id — the same pattern the
  // account profile page uses.
  const [signedInUser] = ctx
    ? await getDb()
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.userId))
        .limit(1)
    : [];
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
        upper sections (search/pinned/saved-searches) are now capped as a GROUP
        at 45% of the nav with their own scrollbar — unbounded, at laptop-height
        viewports with the sections at cap they consumed the whole nav and the
        PAGES tree rendered with ZERO height (the H3 runtime-px guard found it:
        the virtualizer's scroll container measured 0 and no rows mounted at
        all). v0.10.2 S17 — the FAVORITES + RECENTS sections were removed from
        this group: Favorites is now a footer row only and Recents is gone, so
        the upper order is search → PINNED → SAVED SEARCHES.
      */}
      <nav aria-labelledby="sidebar-pages-heading" className="flex min-h-0 flex-1 flex-col p-1.5">
        {/* v0.10.2 S3 — 1px dividers between conceptual groups. divide-y only
            draws between RENDERED children, so sections that return null when
            empty can't stack or strand dividers; border-b marks the
            upper-group ↔ PAGES boundary (the search pill always renders, so
            the group is never empty). */}
        <div
          data-testid="sidebar-upper-groups"
          className="max-h-[45%] shrink-0 divide-y divide-border border-border border-b overflow-y-auto cairn-thin-scrollbar"
        >
          <SearchHintButton />
          <PinnedSection />
          <SavedSearches />
        </div>
        <PagesSection tree={tree} />
      </nav>
      {/* v0.10.2 S9 — favorites are already listed above for the FAVORITES
          section; reuse the length for the footer's gold-star state instead of
          a second query or a client fetch. */}
      <SidebarFooterNav
        version={appVersion()}
        favoritesCount={favorites.length}
        userEmail={signedInUser?.email}
      />
    </div>
  );
}
