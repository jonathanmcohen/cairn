'use client';

import { Clock } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { PrefEntry } from '@/lib/prefs/user-page-prefs';

/**
 * Recents section rendered above the Pages list in the sidebar.
 * Renders nothing when the user has no visited pages in the active workspace.
 */
export function SidebarRecents({ recents }: { recents: PrefEntry[] }) {
  if (recents.length === 0) return null;
  return (
    <section aria-label="Recent pages" className="mb-1.5">
      <div className="mb-1 flex items-center gap-2 px-2">
        <Clock aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Recents</p>
      </div>
      <ul>
        {recents.map((r) => (
          <li key={r.pageId}>
            <Link
              href={`/pages/${r.pageId}` as Route}
              className="flex items-center gap-2 truncate rounded px-2 py-1 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden="true" className="w-4 shrink-0 text-center">
                {r.icon ?? ''}
              </span>
              <span className="truncate">{r.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
