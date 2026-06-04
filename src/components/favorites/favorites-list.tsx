'use client';

import { Star } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { EmptyFavorites } from '@/components/empty-state/variants';
import { useT } from '@/lib/i18n/provider';

export type FavoriteItem = { pageId: string; title: string; icon: string | null };

/**
 * G14 (#161) — renders the /favorites destination that the palette
 * `nav.favorites` command and the Mod+Shift+F shortcut both target.
 */
export function FavoritesList({ items }: { items: FavoriteItem[] }): React.JSX.Element {
  if (items.length === 0) {
    return <EmptyFavorites />;
  }
  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li key={it.pageId}>
          <Link
            href={`/pages/${it.pageId}` as Route}
            className="flex min-h-11 items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent/50"
          >
            <span aria-hidden="true">{it.icon ?? <Star className="size-4" />}</span>
            <span>{it.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Localized page header for /favorites. Kept in this file (rather than a third
 * component module) so the server page can stay a pure server component.
 */
export function FavoritesHeader(): React.JSX.Element {
  const t = useT();
  return (
    <header className="mb-6">
      <h1 className="font-semibold text-2xl">{t('favorites.page.title')}</h1>
      <p className="text-muted-foreground text-sm">{t('favorites.page.description')}</p>
    </header>
  );
}
