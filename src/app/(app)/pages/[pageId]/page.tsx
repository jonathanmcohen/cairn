import { CoverImage } from '@/components/cover-image';
import { Editor } from '@/components/editor/editor';
import { PageIconPicker } from '@/components/page-icon-picker';
import { PageMenu } from '@/components/page-menu';
import { PageTitleInput } from '@/components/page-title-input';
import type * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { notFound } from 'next/navigation';

export default async function PageView({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  let page: schema.Page;
  try {
    ({ page } = await requirePageAccess(pageId, 'viewer'));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <CoverImage pageId={page.id} initial={page.coverUrl} />
      <div className="mb-6 flex items-center gap-3">
        <PageIconPicker pageId={page.id} initial={page.icon} />
        <div className="flex-1">
          <PageTitleInput pageId={page.id} initial={page.title} />
        </div>
        <PageMenu pageId={page.id} />
      </div>
      <Editor
        pageId={page.id}
        initialContent={page.content}
        initialUpdatedAt={page.updatedAt.toISOString()}
      />
    </div>
  );
}
