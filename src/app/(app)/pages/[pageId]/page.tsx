import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Editor } from '@/components/editor/editor';
import { EDITOR_TOOLBAR_SLOT_ID } from '@/components/editor/toolbar-slot';
import { PageIconPicker } from '@/components/page-icon-picker';
import { PageMenu } from '@/components/page-menu';
import { PageTitleInput } from '@/components/page-title-input';
import { ApprovalPanel } from '@/components/pages/approval-panel';
import { BacklinksToggle } from '@/components/pages/backlinks-toggle';
import { CoverBanner } from '@/components/pages/cover-banner';
import { CoverPicker } from '@/components/pages/cover-picker';
import { EditableCover } from '@/components/pages/editable-cover';
import { EncryptPageAction } from '@/components/pages/encrypt-page-action';
import { LockBanner } from '@/components/pages/lock-banner';
import { PageActionPanels } from '@/components/pages/page-action-panels';
import { PageDetailShell } from '@/components/pages/page-detail-shell';
import { PageModeShell } from '@/components/pages/page-mode-shell';
import { PageModeToggles } from '@/components/pages/page-mode-toggles';
import { SeeAlsoPanel } from '@/components/pages/see-also-panel';
import { StatusPicker } from '@/components/pages/status-picker';
import { SubmitForReviewButton } from '@/components/pages/submit-for-review-button';
import { TocSidebar } from '@/components/pages/toc-sidebar';
import { TranslationsPicker } from '@/components/pages/translations-picker';
import { getDb } from '@/db/client';
import type * as schema from '@/db/schema';
import type { PageStatus } from '@/db/schema';
import { auth } from '@/lib/auth/config';
import { HttpError, hasMinRole, type WorkspaceContext } from '@/lib/auth/require-role';
import { userColor } from '@/lib/collab/user-color';
import { env } from '@/lib/env';
import { requirePageAccess } from '@/lib/pages/access';
import { getPageCover } from '@/lib/pages/cover';
import { isLocked } from '@/lib/pages/lock';

export default async function PageView({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  let page: schema.Page;
  let ctx: WorkspaceContext;
  try {
    ({ page, ctx } = await requirePageAccess(pageId, 'viewer'));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  const session = await auth();
  const currentUser = {
    id: ctx.userId,
    name: session?.user?.name ?? 'Anonymous',
    color: userColor(ctx.userId),
    image: session?.user?.image ?? null,
  };

  const cover = await getPageCover(getDb(), page.id, ctx.workspaceId);
  const lockState = await isLocked(getDb(), page.id);
  const canEdit = hasMinRole(ctx.role, 'editor');
  // v0.9.0 G5 P28 — per-device TOC sidebar pref persists as a cookie; the
  // toggle lives at /settings/account/theme. Reading at render time avoids
  // a client-side flicker.
  const cookieStore = await cookies();
  const showTocSidebar = cookieStore.get('cairn-toc-sidebar')?.value === '1';
  // #121 — build-time inlined Unsplash key (optional); passed to CoverPicker so
  // it can render the Unsplash tab. Undefined-tolerant: the picker hides the tab
  // when unset. (This read was removed by round-1 #16 and is restored here.)
  const unsplashKey = env().NEXT_PUBLIC_CAIRN_UNSPLASH_ACCESS_KEY;
  // v0.9.0 G1 P6 — E2E "Encrypt page" affordance gates on the public mirror
  // of CAIRN_ENABLE_E2E_ENCRYPTION. Already-encrypted pages don't render
  // the action (re-encrypt is a separate flow not in this plan).
  const showEncryptAction =
    env().NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION && canEdit && !page.encrypted;

  // v0.9.7 G19 #166 — per-page citation prefs ride on `pages.metadata`.
  const pageMeta = (page.metadata ?? {}) as {
    citation_style?: 'apa' | 'mla' | 'chicago';
    disable_bibliography?: boolean;
  };

  return (
    <PageDetailShell>
      <PageModeShell pageId={page.id}>
        {/* #121 — the in-flow CoverPicker is the single canonical "Add cover" /
            "Change cover" affordance. It writes the live `pages.cover` jsonb via
            /api/pages/[pageId]/cover and refreshes so CoverBanner re-renders.
            #239 — for editors with a cover, the rendered banner is itself
            clickable (EditableCover wraps it + drives the picker). For editors
            without a cover, the standalone "Add cover" button shows below. Public
            / viewer renders the bare banner. */}
        {canEdit ? (
          'kind' in cover ? (
            <EditableCover
              pageId={page.id}
              cover={cover}
              alt={page.title}
              unsplashKey={unsplashKey}
            />
          ) : (
            <div className="mb-2 flex justify-start">
              <CoverPicker pageId={page.id} current={cover} unsplashKey={unsplashKey} />
            </div>
          )
        ) : (
          <CoverBanner cover={cover} alt={page.title} />
        )}
        {/* v0.10.0 E6 — THE single page toolbar row. Page-level actions render
            here directly; the editor-owned control group (suggest/bibliography/
            presence/Live/outline) portals itself into the reserved slot below,
            so the page no longer stacks a second control strip above the
            editor body. `flex-wrap` is the narrow-viewport strategy: at 360px
            the row wraps onto extra lines and every control stays on-screen
            and clickable (the v0.9.19 workspace-switcher overflow lesson). */}
        <div data-testid="page-toolbar" className="mb-6 flex flex-wrap items-center gap-2 sm:gap-3">
          <PageIconPicker pageId={page.id} initial={page.icon} />
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <PageTitleInput pageId={page.id} initial={page.title} />
          </div>
          {/* v0.9.7 G16 #163 — lifecycle status badge/picker + backlinks panel
              toggle, surfaced in the header action bar. */}
          <StatusPicker
            pageId={page.id}
            initialStatus={page.status as PageStatus}
            canEdit={canEdit}
          />
          <BacklinksToggle pageId={page.id} />
          {/* a8 #17 — Focus/Reader mode toggles join the same action bar as the
              page actions below, separated by a thin rule, so the header reads
              as one coherent control group instead of two competing toolbars. */}
          <PageModeToggles />
          {/* v0.9.4 #93 — the comments / version-history / export / lock cluster
              is now a single shared controller that keeps only one panel open
              at a time and dismisses it on Escape. */}
          <PageActionPanels
            pageId={page.id}
            canComment={hasMinRole(ctx.role, 'editor')}
            currentUserId={ctx.userId}
            currentRole={ctx.role}
            canEditVersions={hasMinRole(ctx.role, 'editor')}
            canLock={canEdit}
            canMove={hasMinRole(ctx.role, 'editor')}
          />
          {showEncryptAction && (
            <EncryptPageAction
              pageId={page.id}
              workspaceId={page.workspaceId}
              currentDoc={page.content}
            />
          )}
          <PageMenu
            pageId={page.id}
            initialPublished={page.published}
            initialSlug={page.publicSlug}
            pageTitle={page.title}
            initialAllowDuplication={page.allowDuplication}
            initialHasPassword={!!page.linkPasswordHash}
            initialExpiresAt={page.expiresAt ? page.expiresAt.toISOString() : null}
          />
          {/* v0.10.0 E6 — reserved slot for the editor's control group.
              `display: contents` makes the portaled children direct flex items
              of this bar. Server-rendered empty; <Editor> fills it client-side
              once it hydrates (the controls were client-only before E6 too). */}
          <div id={EDITOR_TOOLBAR_SLOT_ID} className="contents" />
        </div>
        {/* v0.9.0 G2 P14 — locked-page banner; null when the page is unlocked. */}
        <LockBanner
          pageId={page.id}
          viewerUserId={ctx.userId}
          viewerIsAdmin={hasMinRole(ctx.role, 'admin')}
        />
        {/* v0.9.0 G4 P24 — approval panel; null when not in review and no history. */}
        <ApprovalPanel
          pageId={page.id}
          canDecide={hasMinRole(ctx.role, 'admin')}
          inReview={page.status === 'review'}
        />
        {/* v0.9.7 G16 #163 — editor-facing "Submit for review" control, gated to
            the statuses transitionStatus allows into review (draft/published). */}
        {canEdit && (page.status === 'draft' || page.status === 'published') && (
          <SubmitForReviewButton pageId={page.id} />
        )}
        <Editor
          pageId={page.id}
          workspaceId={page.workspaceId}
          initialContent={page.content}
          initialUpdatedAt={page.updatedAt.toISOString()}
          currentUser={currentUser}
          editable={hasMinRole(ctx.role, 'editor')}
          encrypted={page.encrypted}
          locked={lockState.locked}
          lockedUntilIso={lockState.lockedUntil ? lockState.lockedUntil.toISOString() : null}
          initialDisableBibliography={pageMeta.disable_bibliography ?? false}
          citationStyle={pageMeta.citation_style ?? 'apa'}
        />
      </PageModeShell>
      {/* v0.9.0 G5 P28 — sticky TOC sidebar, gated by the
          `cairn-toc-sidebar` cookie set by the Settings toggle. Rendered
          in-flow inside PageDetailShell (the shell has no right-rail slot)
          and absolutely positioned on xl+ viewports; hidden below xl where
          there's no room.
          a9 #18 — the rail is anchored to the RIGHT EDGE OF THE CENTERED
          max-w-3xl reading column (`left-1/2` + a `24rem` = half-of-3xl
          translate), NOT to the viewport's right edge. Previously it floated
          against the viewport with no positioned ancestor, leaving a dead
          band of empty whitespace between the column and the rail. Anchoring
          it to the column makes the gutter intentional, and `TocSidebar`
          returns null when the page has no headings so the rail never shows
          empty. */}
      {showTocSidebar ? (
        <aside className="pointer-events-none absolute left-1/2 top-32 hidden translate-x-[calc(24rem+1.5rem)] xl:block xl:w-56">
          <div className="pointer-events-auto">
            <TocSidebar initialDoc={page.content} />
          </div>
        </aside>
      ) : null}
      {/* v0.9.0 G5 P27 — "See also" related-pages panel (vector kNN, ACL-gated).
          PageDetailShell has no right-rail slot so this renders in-flow below
          the editor. The helper excludes encrypted pages server-side. */}
      <div className="mt-10">
        <SeeAlsoPanel pageId={page.id} viewerUserId={ctx.userId} />
      </div>
      {/* v0.9.7 G16 #163 — page translations linker; read-only for viewers. */}
      <div className="mt-10">
        <TranslationsPicker pageId={page.id} canEdit={canEdit} />
      </div>
    </PageDetailShell>
  );
}
