'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SearchMode } from '@/lib/pages/search';

/** The backend's three retrieval strategies, in display order. Mirrors
 * `SearchModeSchema` in src/app/api/search/route.ts. */
export const SEARCH_MODES = ['fts', 'semantic', 'hybrid'] as const satisfies readonly SearchMode[];

const STORAGE_KEY = 'cairn:search-mode';

function isMode(v: string | null): v is SearchMode {
  return v === 'fts' || v === 'semantic' || v === 'hybrid';
}

/**
 * Read/write the user's preferred search mode, persisted to localStorage so
 * it survives palette reopen and full-page reloads. SSR-safe: the initial
 * render is always `'fts'` (server + first client render match), then an
 * effect hydrates the stored value to avoid a hydration mismatch.
 */
export function useSearchMode(): { mode: SearchMode; setMode: (m: SearchMode) => void } {
  const [mode, setModeState] = useState<SearchMode>('fts');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isMode(stored)) setModeState(stored);
    } catch {
      // localStorage unavailable (private mode / SSR) — keep the default.
    }
  }, []);

  const setMode = useCallback((m: SearchMode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(STORAGE_KEY, m);
    } catch {
      // ignore write failures
    }
  }, []);

  return { mode, setMode };
}
