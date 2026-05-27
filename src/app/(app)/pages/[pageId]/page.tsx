import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { CommentsToggle } from '@/components/comments/comments-toggle';
import { CoverImage } from '@/components/cover-image';
import { Editor } from '@/components/editor/editor';
import { PageIconPicker } from '@/components/page-icon-picker';
import { PageMenu } from '@/components/page-menu';
import { PageTitleInput } from '@/components/page-title-input';
import { ApprovalPanel } from '@/components/pages/approval-panel';
import { CoverBanner } from '@/components/pages/cover-banner';
import { CoverPicker } from '@/components/pages/cover-picker';
import { EncryptPageAction } from '@/components/pages/encrypt-page-action';
import { PageExportMenu } from '@/components/pages/export-menu';
import { LockBanner } from '@/components/pages/lock-banner';
import { LockToggle } from '@/components/pages/lock-toggle';
import { PageDetailShell } from '@/components/pages/page-detail-shell';
import { PageModeShell } from '@/components/pages/page-mode-shell';
import { PageModeToggles } from '@/components/pages/page-mode-toggles';
import { SeeAlsoPanel } from '@/components/pages/see-also-panel';
import { TocSidebar } from '@/components/pages/toc-sidebar';
import { VersionHistory } from '@/components/pages/version-history';
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
  const unsplashKey = env().NEXT_PUBLIC_CAIRN_UNSPLASH_ACCESS_KEY;
  // v0.9.0 G1 P6 — E2E "Encrypt page" affordance gates on the public mirror
  // of CAIRN_ENABLE_E2E_ENCRYPTION. Already-encrypted pages don't render
  // the action (re-encrypt is a separate flow not in this plan).
  const showEncryptAction =
    env().NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION && canEdit && !page.encrypted;

  return (
    <PageDetailShell>
      <PageModeShell toggles={<PageModeToggles />}>
        <CoverBanner cover={cover} alt={page.title} />
        {canEdit && (
          <div className="mb-2 flex justify-end">
            <CoverPicker pageId={page.id} current={cover} unsplashKey={unsplashKey} />
          </div>
        )}
        <CoverImage pageId={page.id} initial={page.coverUrl} />
        <div className="mb-6 flex flex-wrap items-center gap-2 sm:gap-3">
          <PageIconPicker pageId={page.id} initial={page.icon} />
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <PageTitleInput pageId={page.id} initial={page.title} />
          </div>
          <CommentsToggle
            pageId={page.id}
            canComment={hasMinRole(ctx.role, 'editor')}
            currentUserId={ctx.userId}
            currentRole={ctx.role}
          />
          <VersionHistory pageId={page.id} canEdit={hasMinRole(ctx.role, 'editor')} />
          <PageExportMenu pageId={page.id} />
          {canEdit && <LockToggle pageId={page.id} />}
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
          and absolutely positioned to the right of the editor on xl+
          viewports; hidden below xl where there's no room. */}
      {showTocSidebar ? (
        <aside className="pointer-events-none absolute right-4 top-32 hidden xl:block xl:w-56">
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
