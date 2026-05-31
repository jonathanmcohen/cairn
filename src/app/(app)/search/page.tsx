/**
 * G14 (#161) — /search. Consumes the `?q=` carried in from a saved search or
 * the palette, then renders the SearchChipInput operator builder + live
 * results. Before G14 this route 404'd, so saved searches had no destination.
 */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SearchPageHeader, SearchPageView } from '@/components/search/search-page-view';
import { getAuthContext } from '@/lib/auth/require-role';
import { LOCALE_COOKIE } from '@/lib/i18n/config';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';
import { resolveLocale } from '@/lib/i18n/resolve';

type SearchParams = Record<string, string | string[] | undefined>;

function parseQueryParam(s: string | string[] | undefined): string {
  if (typeof s === 'string') return s;
  if (Array.isArray(s) && typeof s[0] === 'string') return s[0];
  return '';
}

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactNode> {
  const ctx = await getAuthContext();
  if (!ctx?.userId || !ctx.workspaceId) redirect('/login');

  const sp = await searchParams;
  const initialQuery = parseQueryParam(sp.q);

  // Mirror the app-shell locale resolution (see src/app/layout.tsx).
  const cookieStore = await cookies();
  const hdrs = await headers();
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    hdrs.get('accept-language'),
  );
  const messages = getMessages(locale);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <main className="mx-auto max-w-3xl p-6">
        <SearchPageHeader />
        <SearchPageView initialQuery={initialQuery} />
      </main>
    </I18nProvider>
  );
}
