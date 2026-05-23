'use client';

import { Star } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PrefEntry } from '@/lib/prefs/user-page-prefs';

/**
 * Favorites section with native HTML drag-reorder and a star toggle to
 * unfavorite. Renders nothing when the user has no favorites in the active
 * workspace. Mutations POST to the prefs API + `router.refresh()`.
 */
export function SidebarFavorites({ favorites }: { favorites: PrefEntry[] }) {
  const router = useRouter();
  const [items, setItems] = useState<PrefEntry[]>(favorites);
  const [dragId, setDragId] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function onDrop(targetPageId: string) {
    if (!dragId || dragId === targetPageId) {
      setDragId(null);
      return;
    }
    const fromIdx = items.findIndex((i) => i.pageId === dragId);
    const toIdx = items.findIndex((i) => i.pageId === targetPageId);
    if (fromIdx < 0 || toIdx < 0) {
      setDragId(null);
      return;
    }
    const next = items.slice();
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) {
      setDragId(null);
      return;
    }
    next.splice(toIdx, 0, moved);
    setItems(next);
    setDragId(null);
    await fetch('/api/prefs/favorites/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedPageIds: next.map((i) => i.pageId) }),
    });
    router.refresh();
  }

  async function onUnfavorite(pageId: string) {
    setItems((prev) => prev.filter((i) => i.pageId !== pageId));
    await fetch('/api/prefs/favorites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId }),
    });
    router.refresh();
  }

  return (
    <section aria-label="Favorite pages" className="mb-3">
      <div className="mb-1 flex items-center gap-2 px-2">
        <Star aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Favorites</p>
      </div>
      <ul>
        {items.map((f) => (
          <li
            key={f.pageId}
            draggable
            onDragStart={() => setDragId(f.pageId)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(f.pageId)}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent"
          >
            <Link
              href={`/pages/${f.pageId}` as Route}
              className="flex flex-1 items-center gap-2 truncate"
            >
              <span aria-hidden="true" className="w-4 shrink-0 text-center">
                {f.icon ?? ''}
              </span>
              <span className="truncate">{f.title}</span>
            </Link>
            <button
              type="button"
              aria-label={`Unfavorite ${f.title}`}
              onClick={() => onUnfavorite(f.pageId)}
              className="rounded p-1 text-muted-foreground hover:bg-background"
            >
              <Star aria-hidden="true" className="h-3 w-3 fill-current" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
