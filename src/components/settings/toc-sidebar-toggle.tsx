'use client';

import { useEffect, useState } from 'react';

const COOKIE_NAME = 'cairn-toc-sidebar';
const STORAGE_KEY = 'cairn:toc-sidebar:show';

/**
 * Per-user "show TOC sidebar" toggle. Persists in localStorage + a same-name
 * cookie so server-side render on /pages/[pageId] can read it without a
 * round-trip to the DB. Cookie is intentionally NOT HttpOnly — the client
 * writes it directly via document.cookie.
 *
 * No database column, no migration — the toggle is per-device. If we ever
 * promote it to a real per-user pref, a future plan adds a column + a sync
 * route; for v0.9 P28 the localStorage/cookie pair is the spec contract.
 */
export function TocSidebarToggle() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === '1') setEnabled(true);
  }, []);

  function persist(next: boolean) {
    setEnabled(next);
    if (next) {
      localStorage.setItem(STORAGE_KEY, '1');
      // 365-day cookie scoped to the entire app.
      document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    } else {
      localStorage.removeItem(STORAGE_KEY);
      document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    }
  }

  return (
    <label className="flex items-center gap-3 text-sm">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => persist(e.target.checked)}
        aria-label="Show table-of-contents sidebar"
      />
      <span>
        Show table-of-contents sidebar
        <span className="ml-2 text-xs text-muted-foreground">
          (per-device; appears on every /pages/&lt;id&gt; with headings)
        </span>
      </span>
    </label>
  );
}
