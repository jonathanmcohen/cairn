import { notFound } from 'next/navigation';
import { CoverImage } from '@/components/cover-image';
import { Editor } from '@/components/editor/editor';
import { PageIconPicker } from '@/components/page-icon-picker';
import { PageMenu } from '@/components/page-menu';
import { PageTitleInput } from '@/components/page-title-input';
import type * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';
import { HttpError, hasMinRole, type WorkspaceContext } from '@/lib/auth/require-role';
import { userColor } from '@/lib/collab/user-color';
import { requirePageAccess } from '@/lib/pages/access';

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

  return (
    <div className="mx-auto max-w-3xl">
      <CoverImage pageId={page.id} initial={page.coverUrl} />
      <div className="mb-6 flex items-center gap-3">
        <PageIconPicker pageId={page.id} initial={page.icon} />
        <div className="flex-1">
          <PageTitleInput pageId={page.id} initial={page.title} />
        </div>
        <PageMenu
          pageId={page.id}
          initialPublished={page.published}
          initialSlug={page.publicSlug}
        />
      </div>
      <Editor
        pageId={page.id}
        initialContent={page.content}
        initialUpdatedAt={page.updatedAt.toISOString()}
        currentUser={currentUser}
        editable={hasMinRole(ctx.role, 'editor')}
      />
    </div>
  );
}
