'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchChipInput } from '@/components/search/search-chip-input';
import { useT } from '@/lib/i18n/provider';

type SearchResult = {
  id: string;
  title: string;
  snippet: string | null;
  breadcrumb: { id: string; title: string }[];
};

/**
 * G14 (#161) — the /search landing surface. Seeds the SearchChipInput with the
 * `?q=` carried in from a saved search (or the palette), reparses operators on
 * every keystroke, and re-runs /api/search (debounced). Results link straight
 * to the page.
 */
export function SearchPageView({ initialQuery }: { initialQuery: string }): React.JSX.Element {
  const t = useT();
  const [raw, setRaw] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (query: string) => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        setResults([]);
        setLoaded(true);
        return;
      }
      const data = (await res.json()) as { results: SearchResult[] };
      setResults(Array.isArray(data.results) ? data.results : []);
      setLoaded(true);
    } catch {
      setResults([]);
      setLoaded(true);
    }
  }, []);

  // Debounced re-query whenever the raw query string changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (raw.trim() === '') {
      setResults([]);
      setLoaded(true);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(raw);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [raw, runSearch]);

  return (
    <div className="space-y-4">
      <SearchChipInput initialValue={initialQuery} onChange={(r) => setRaw(r.raw)} />
      {loaded && results.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('search.page.empty')}</p>
      ) : (
        <>
          {results.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('search.page.resultsCount', { count: results.length })}
            </p>
          ) : null}
          <ul className="space-y-1">
            {results.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/pages/${r.id}` as Route}
                  className="block min-h-11 rounded px-3 py-2 text-sm hover:bg-accent/50"
                >
                  <span className="font-medium">{r.title}</span>
                  {r.snippet ? (
                    <span className="ml-2 text-muted-foreground">{r.snippet}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Localized page header for /search. Kept in this file so the server page can
 * stay a pure server component.
 */
export function SearchPageHeader(): React.JSX.Element {
  const t = useT();
  return (
    <header className="mb-6">
      <h1 className="font-semibold text-2xl">{t('search.page.title')}</h1>
      <p className="text-muted-foreground text-sm">{t('search.page.description')}</p>
    </header>
  );
}
