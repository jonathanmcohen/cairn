'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { InlineIcon } from '@/components/page-icon-inline';

/**
 * v0.9.0 G2 P12 — Workspace-pinned section row shape (mirrors `PinRow` from
 * `@/lib/pins/list`, but redeclared client-side so this leaf component
 * imports nothing server-only).
 */
type PinRow = { pageId: string; title: string; icon: string | null; position: number };

/**
 * Workspace-wide "Pinned" section at the very top of the sidebar.
 *
 * Renders above the per-user Favorites group (v0.8 P17) and the per-space
 * groups (v0.9 P11). Fetches once on mount via `GET /api/workspace/pins` —
 * the route is gated to workspace members, so an unauthenticated user gets
 * 401 + an empty render.
 *
 * Returns `null` when the workspace has no pins so the section collapses to
 * zero pixels rather than rendering an empty header.
 */
export function PinnedSection() {
  const [pins, setPins] = useState<PinRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workspace/pins');
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { pins: PinRow[] };
        if (!cancelled) setPins(body.pins);
      } catch {
        // ignore — sidebar is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!pins || pins.length === 0) return null;

  return (
    <section data-testid="pinned-section" className="mb-3 px-2">
      {/* v0.10.2 S4 — font-semibold dropped: Pinned was the lone semibold
          outlier among the five section headers; all now share 10px/60%
          regular weight. */}
      <div className="mb-1 px-2 text-[length:var(--cairn-sidebar-heading)] uppercase tracking-wide text-foreground/60">
        Pinned
      </div>
      <ul>
        {pins.map((p) => (
          <li key={p.pageId}>
            <Link
              href={`/pages/${p.pageId}` as Route}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {p.icon ? (
                <span aria-hidden="true" className="text-base leading-none">
                  <InlineIcon value={p.icon} fallback={null} />
                </span>
              ) : null}
              <span className="truncate">{p.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
