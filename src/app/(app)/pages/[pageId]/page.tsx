import { notFound } from 'next/navigation';
import { CoverImage } from '@/components/cover-image';
import { Editor } from '@/components/editor/editor';
import { PageIconPicker } from '@/components/page-icon-picker';
import { PageMenu } from '@/components/page-menu';
import { PageTitleInput } from '@/components/page-title-input';
import type * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';
import { HttpError, type WorkspaceContext } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';

// Deterministic caret color per user, so collaborators are visually stable.
const CARET_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

function caretColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return CARET_COLORS[Math.abs(hash) % CARET_COLORS.length] ?? '#3b82f6';
}

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
    name: session?.user?.name ?? 'Anonymous',
    color: caretColor(ctx.userId),
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
      />
    </div>
  );
}
