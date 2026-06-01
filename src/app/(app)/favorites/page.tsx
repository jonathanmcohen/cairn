/**
 * G14 (#161) — /favorites. The palette `nav.favorites` command and the
 * Mod+Shift+F shortcut both push here; before G14 this route 404'd. Reuses the
 * existing favorites pref store (listFavorites).
 */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { FavoritesHeader, FavoritesList } from '@/components/favorites/favorites-list';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { LOCALE_COOKIE } from '@/lib/i18n/config';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';
import { resolveLocale } from '@/lib/i18n/resolve';
import { listFavorites } from '@/lib/prefs/user-page-prefs';

export const dynamic = 'force-dynamic';

export default async function FavoritesPage(): Promise<React.ReactNode> {
  const ctx = await getAuthContext();
  if (!ctx?.userId || !ctx.workspaceId) redirect('/login');

  const favorites = await listFavorites(getDb(), {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  const items = favorites.map((f) => ({ pageId: f.pageId, title: f.title, icon: f.icon }));

  // Mirror the app-shell locale resolution (see src/app/layout.tsx): cookie
  // first, then Accept-Language. The root layout already wraps the tree in an
  // I18nProvider, but this page nests its own so it stays self-contained.
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
        <FavoritesHeader />
        <FavoritesList items={items} />
      </main>
    </I18nProvider>
  );
}
