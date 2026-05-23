'use client';

import { Bookmark } from 'lucide-react';
import { useEffect, useState } from 'react';

type Saved = {
  id: string;
  name: string;
  query: string;
  filters: Record<string, unknown>;
};

/**
 * Minimal per-user saved-searches sidebar section. Loads on mount, renders
 * nothing when empty. Clicking a row navigates to `/search?q=...`; the × button
 * deletes after a `confirm()`. Inline rename is deferred polish.
 */
export function SavedSearches() {
  const [items, setItems] = useState<Saved[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/search/saved');
        if (!r.ok) return;
        const data = (await r.json()) as { savedSearches: Saved[] };
        if (!cancelled) setItems(data.savedSearches);
      } catch {
        // silent — section just stays empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete saved search "${name}"?`)) return;
    const r = await fetch(`/api/search/saved/${id}`, { method: 'DELETE' });
    if (r.ok) setItems((xs) => xs.filter((x) => x.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <section aria-label="Saved searches" className="mb-3">
      <div className="mb-1 flex items-center gap-2 px-2">
        <Bookmark aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Saved searches</p>
      </div>
      <ul>
        {items.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent"
          >
            <a
              className="flex-1 truncate"
              href={`/search?q=${encodeURIComponent(s.query)}`}
              title={s.name}
            >
              {s.name}
            </a>
            <button
              type="button"
              aria-label={`Delete saved search ${s.name}`}
              onClick={() => void remove(s.id, s.name)}
              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
