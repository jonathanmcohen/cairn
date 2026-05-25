import { notFound } from 'next/navigation';
import { CommentsToggle } from '@/components/comments/comments-toggle';
import { CoverImage } from '@/components/cover-image';
import { Editor } from '@/components/editor/editor';
import { PageIconPicker } from '@/components/page-icon-picker';
import { PageMenu } from '@/components/page-menu';
import { PageTitleInput } from '@/components/page-title-input';
import { CoverBanner } from '@/components/pages/cover-banner';
import { CoverPicker } from '@/components/pages/cover-picker';
import { PageExportMenu } from '@/components/pages/export-menu';
import { PageDetailShell } from '@/components/pages/page-detail-shell';
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
  const unsplashKey = env().NEXT_PUBLIC_CAIRN_UNSPLASH_ACCESS_KEY;

  return (
    <PageDetailShell>
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
      <Editor
        pageId={page.id}
        workspaceId={page.workspaceId}
        initialContent={page.content}
        initialUpdatedAt={page.updatedAt.toISOString()}
        currentUser={currentUser}
        editable={hasMinRole(ctx.role, 'editor')}
      />
    </PageDetailShell>
  );
}
