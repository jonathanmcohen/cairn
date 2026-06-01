'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchChipInput } from '@/components/search/search-chip-input';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';
import { SEARCH_MODES, useSearchMode } from '@/lib/search/use-search-mode';

type SearchResult = {
  id: string;
  title: string;
  snippet: string | null;
  breadcrumb: { id: string; title: string }[];
};

type PeerResult = SearchResult & { peerName?: string };

type SearchResponse = {
  results: SearchResult[];
  peer_results?: PeerResult[];
};

/**
 * G14 (#161) — the /search landing surface. Seeds the SearchChipInput with the
 * `?q=` carried in from a saved search (or the palette), reparses operators on
 * every keystroke, and re-runs /api/search (debounced). Results link straight
 * to the page.
 *
 * G17 (#164) — extended with a fts/semantic/hybrid mode toggle (shared with the
 * command palette via useSearchMode, sent as `&mode=`), an explicit Search
 * submit, and an admin-only "all workspaces" toggle that sends
 * `include_all_workspaces=true` (the route already honors it for admin/owner)
 * and renders the federated `peer_results` alongside local hits.
 */
export function SearchPageView({
  initialQuery,
  canFederate = false,
}: {
  initialQuery: string;
  /** True for admin/owner — gates the cross-workspace federated toggle. */
  canFederate?: boolean;
}): React.JSX.Element {
  const t = useT();
  const { mode, setMode } = useSearchMode();
  const [raw, setRaw] = useState(initialQuery);
  const [includeAll, setIncludeAll] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [peers, setPeers] = useState<PeerResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (query: string) => {
      try {
        const params = new URLSearchParams({ q: query, mode });
        if (canFederate && includeAll) params.set('include_all_workspaces', 'true');
        const res = await fetch(`/api/search?${params.toString()}`);
        if (!res.ok) {
          setResults([]);
          setPeers([]);
          setLoaded(true);
          return;
        }
        const data = (await res.json()) as SearchResponse;
        setResults(Array.isArray(data.results) ? data.results : []);
        setPeers(Array.isArray(data.peer_results) ? data.peer_results : []);
        setLoaded(true);
      } catch {
        setResults([]);
        setPeers([]);
        setLoaded(true);
      }
    },
    [mode, canFederate, includeAll],
  );

  // Debounced re-query whenever the raw query string or mode changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (raw.trim() === '') {
      setResults([]);
      setPeers([]);
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

      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">{t('search.mode.label')}</legend>
        <span className="text-muted-foreground text-xs">{t('search.mode.label')}</span>
        {SEARCH_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`rounded px-2 py-1 text-xs ${
              mode === m
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {t(`search.mode.${m}`)}
          </button>
        ))}
        <Button type="button" size="sm" onClick={() => void runSearch(raw)}>
          {t('search.page.submit')}
        </Button>
      </fieldset>

      <p className="text-muted-foreground text-xs">{t('search.mode.hint')}</p>

      {canFederate ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeAll}
            aria-label={t('search.federated.toggle')}
            onChange={(e) => setIncludeAll(e.target.checked)}
          />
          <span>{t('search.federated.toggle')}</span>
          <span className="text-muted-foreground text-xs">{t('search.federated.hint')}</span>
        </label>
      ) : null}

      {loaded && results.length === 0 && peers.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('search.page.empty')}</p>
      ) : (
        <>
          {results.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('search.page.resultsCount', { count: results.length })}
            </p>
          ) : null}
          {results.length > 0 ? (
            <section aria-label={peers.length > 0 ? t('search.page.localHeading') : undefined}>
              {peers.length > 0 ? (
                <h2 className="mb-1 font-medium text-muted-foreground text-xs">
                  {t('search.page.localHeading')}
                </h2>
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
            </section>
          ) : null}
          {peers.length > 0 ? (
            <section aria-label={t('search.page.peerHeading')}>
              <h2 className="mb-1 font-medium text-muted-foreground text-xs">
                {t('search.page.peerHeading')}
              </h2>
              <ul className="space-y-1">
                {peers.map((p) => (
                  <li key={`peer-${p.peerName ?? 'peer'}-${p.id}`} className="px-3 py-2 text-sm">
                    <span className="font-medium">{p.title}</span>
                    {p.peerName ? (
                      <span className="ml-2 text-muted-foreground text-xs">{p.peerName}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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
