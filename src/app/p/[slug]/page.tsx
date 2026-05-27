import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ReadOnlyView } from '@/components/editor/read-only-view';
import { Bibliography } from '@/components/editor/extensions/bibliography';
import { CoverBanner } from '@/components/pages/cover-banner';
import { ThemeProvider as UserThemeProvider } from '@/components/themes/theme-provider';
import { getDb } from '@/db/client';
import type { CitationStyle } from '@/lib/citations/format';
import { env } from '@/lib/env';
import { getPageCover } from '@/lib/pages/cover';
import { resignDocumentImages } from '@/lib/pages/public';
import { requirePublicPageAccess } from '@/lib/pages/share';
import { cookieNameFor, verifyAccessCookieValue } from '@/lib/pages/share-cookie';
import { previewAccepted } from '@/lib/suggestions/transform';
import { getThemePrefs } from '@/lib/themes/prefs';
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
  // Resolve every suggestion to its accepted state BEFORE rendering: published
  // pages show inserts as plain accepted text and never expose delete-marked
  // text or suggestion chrome. Then re-sign image URLs (disjoint concerns).
  const clean = previewAccepted(page.content as Parameters<typeof previewAccepted>[0]);
  const content = resignDocumentImages(clean, env().AUTH_SECRET);

  // Public pages render under the author's theme (no viewer user on /p/<id>).
  const authorPrefs = await getThemePrefs(db, page.createdBy);
  const cover = await getPageCover(db, page.id, page.workspaceId);

  // v0.9.0 G3 P18 — Per-page citation prefs ride on `pages.metadata` jsonb
  // (no migration in this plan). `citation_style` defaults to 'apa';
  // `disable_bibliography` lets authors hide the auto-aggregated section.
  const meta = (page.metadata ?? {}) as {
    citation_style?: CitationStyle;
    disable_bibliography?: boolean;
  };
  const citationStyle: CitationStyle = meta.citation_style ?? 'apa';
  const showBibliography = !meta.disable_bibliography;

  return (
    <UserThemeProvider initialPrefs={authorPrefs}>
      <CoverBanner cover={cover} alt={page.title} />
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-6 flex items-center gap-2 text-3xl font-bold">
          {page.icon && <span aria-hidden>{page.icon}</span>}
          {page.title}
        </h1>
        <ReadOnlyView content={content} />
        {showBibliography && <Bibliography doc={content} style={citationStyle} />}
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
    </UserThemeProvider>
  );
}
