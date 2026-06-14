'use client';

import { useEffect, useState } from 'react';

/**
 * v0.10.2 S9 — fetch-on-mount count for a sidebar nav badge. Cosmetic and
 * fail-OPEN by contract: any failure (network, non-2xx, bad JSON, wrong
 * shape, fetch unavailable) leaves the count at 0 so the row renders with no
 * pill — a broken count endpoint must never break the nav. One-shot fetch
 * (no polling): the counts are orientation hints, not live notifications
 * (the bell already owns the polling budget).
 */
export function useNavCount(url: string): number {
  const [navCount, setNavCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    try {
      fetch(url, { credentials: 'include', cache: 'no-store' })
        .then((res) => (res.ok ? (res.json() as Promise<{ count?: unknown }>) : null))
        .then((data) => {
          if (!cancelled && data && typeof data.count === 'number' && Number.isFinite(data.count)) {
            setNavCount(data.count);
          }
        })
        .catch(() => {
          // fail-open: no badge
        });
    } catch {
      // fail-open: fetch itself unavailable/threw synchronously
    }
    return () => {
      cancelled = true;
    };
  }, [url]);
  return navCount;
}

/**
 * Right-edge count pill for a sidebar nav row. `ml-auto` pushes it to the
 * row's right edge inside the row's flex (explicitly NOT a corner/avatar
 * dot). Renders nothing at 0 — absence is the "all clear" state. The visible
 * number is aria-hidden with an sr-only i18n twin (`label`) so screen
 * readers never get a bare, context-free numeral.
 */
export function NavCountPill({
  count,
  label,
  testId,
}: {
  count: number;
  label: string;
  testId: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      data-testid={testId}
      className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground leading-none tabular-nums"
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
