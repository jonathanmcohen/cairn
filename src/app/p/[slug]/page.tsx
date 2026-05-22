import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ReadOnlyView } from '@/components/editor/read-only-view';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { resignDocumentImages } from '@/lib/pages/public';
import { requirePublicPageAccess } from '@/lib/pages/share';
import { cookieNameFor, verifyAccessCookieValue } from '@/lib/pages/share-cookie';
import { GateForm } from './gate-form';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();

  let access = await requirePublicPageAccess(db, slug, false);
  if (access.ok === false) notFound();

  // Password-protected: re-check with a valid signed access cookie.
  if (access.ok === 'gate') {
    const cookieValue = (await cookies()).get(cookieNameFor(access.page.id))?.value;
    const hasValidCookie =
      !!cookieValue &&
      verifyAccessCookieValue({
        pageId: access.page.id,
        value: cookieValue,
        secret: env().AUTH_SECRET,
      });
    if (!hasValidCookie) {
      return <GateForm slug={slug} />;
    }
    access = await requirePublicPageAccess(db, slug, true);
    if (access.ok !== true) notFound();
  }

  const { page } = access;
  const content = resignDocumentImages(page.content, env().AUTH_SECRET);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 flex items-center gap-2 text-3xl font-bold">
        {page.icon && <span aria-hidden>{page.icon}</span>}
        {page.title}
      </h1>
      <ReadOnlyView content={content} />
      {page.allowDuplication && (
        <form
          action={`/api/pages/${page.id}/duplicate-public`}
          method="post"
          className="mt-12 border-t pt-6"
        >
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Duplicate to my workspace
          </button>
        </form>
      )}
    </div>
  );
}
