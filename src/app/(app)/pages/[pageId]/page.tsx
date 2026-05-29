import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { CoverImage } from '@/components/cover-image';
import { Editor } from '@/components/editor/editor';
import { PageIconPicker } from '@/components/page-icon-picker';
import { PageMenu } from '@/components/page-menu';
import { PageTitleInput } from '@/components/page-title-input';
import { ApprovalPanel } from '@/components/pages/approval-panel';
import { CoverBanner } from '@/components/pages/cover-banner';
import { EncryptPageAction } from '@/components/pages/encrypt-page-action';
import { LockBanner } from '@/components/pages/lock-banner';
import { PageActionPanels } from '@/components/pages/page-action-panels';
import { PageDetailShell } from '@/components/pages/page-detail-shell';
import { PageModeShell } from '@/components/pages/page-mode-shell';
import { PageModeToggles } from '@/components/pages/page-mode-toggles';
import { SeeAlsoPanel } from '@/components/pages/see-also-panel';
import { TocSidebar } from '@/components/pages/toc-sidebar';
import { getDb } from '@/db/client';
import type * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';
import { HttpError, hasMinRole, type WorkspaceContext } from '@/lib/auth/require-role';
import { userColor } from '@/lib/collab/user-color';
import { env } from '@/lib/env';
import { requirePageAccess } from '@/lib/pages/access';
import { getPageCover } from '@/lib/pages/cover';

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
  const canEdit = hasMinRole(ctx.role, 'editor');
  // v0.9.0 G5 P28 — per-device TOC sidebar pref persists as a cookie; the
  // toggle lives at /settings/account/theme. Reading at render time avoids
  // a client-side flicker.
  const cookieStore = await cookies();
  const showTocSidebar = cookieStore.get('cairn-toc-sidebar')?.value === '1';
  // v0.9.0 G1 P6 — E2E "Encrypt page" affordance gates on the public mirror
  // of CAIRN_ENABLE_E2E_ENCRYPTION. Already-encrypted pages don't render
  // the action (re-encrypt is a separate flow not in this plan).
  const showEncryptAction =
    env().NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION && canEdit && !page.encrypted;

  return (
    <PageDetailShell>
      <PageModeShell>
        <CoverBanner cover={cover} alt={page.title} />
        {/* a7 #16 — the in-flow <CoverImage> button below is the single canonical
            "Add cover" / "Change" affordance; it sits where the cover renders.
            The previously floating <CoverPicker> mount was removed to avoid two
            competing cover controls. */}
        <CoverImage pageId={page.id} initial={page.coverUrl} />
        <div className="mb-6 flex flex-wrap items-center gap-2 sm:gap-3">
          <PageIconPicker pageId={page.id} initial={page.icon} />
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <PageTitleInput pageId={page.id} initial={page.title} />
          </div>
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
        <Editor
          pageId={page.id}
          workspaceId={page.workspaceId}
          initialContent={page.content}
          initialUpdatedAt={page.updatedAt.toISOString()}
          currentUser={currentUser}
          editable={hasMinRole(ctx.role, 'editor')}
          encrypted={page.encrypted}
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
    </PageDetailShell>
  );
}
