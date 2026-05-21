import { notFound } from 'next/navigation';
import { ReadOnlyView } from '@/components/editor/read-only-view';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { getPublishedPageBySlug, resignDocumentImages } from '@/lib/pages/public';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPublishedPageBySlug(getDb(), slug);
  if (!page) notFound();

  const content = resignDocumentImages(page.content, env().AUTH_SECRET);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 flex items-center gap-2 text-3xl font-bold">
        {page.icon && <span aria-hidden>{page.icon}</span>}
        {page.title}
      </h1>
      <ReadOnlyView content={content} />
    </div>
  );
}
