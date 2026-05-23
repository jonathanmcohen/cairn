'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type ActivityEntry = {
  id: string;
  action: string;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type ActivityResponse = {
  entries: ActivityEntry[];
  nextCursor: string | null;
};

// Subset of the documented action vocabulary that actually targets a page
// (spec §2.27). The audit log can carry other actions for a given workspace,
// but per-page activity is filtered to `targetType: 'page'` at the query layer,
// so we only need labels for actions whose target is a page.
const PAGE_ACTION_LABEL: Record<string, string> = {
  'page.published': 'Published',
  'page.unpublished': 'Unpublished',
  'page.share_changed': 'Share settings changed',
  'page.deleted': 'Deleted',
  'page.version_restored': 'Version restored',
};

function labelFor(action: string): string {
  return PAGE_ACTION_LABEL[action] ?? action;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

export function PageActivityFeed({ pageId }: { pageId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/activity`);
      if (!res.ok) {
        setError(`Failed to load activity (${res.status})`);
        return;
      }
      const body = (await res.json()) as ActivityResponse;
      setEntries(body.entries);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (loading && entries.length === 0) {
    return <p className="text-muted-foreground text-xs">Loading activity…</p>;
  }
  if (error) {
    return <p className="text-destructive text-xs">{error}</p>;
  }
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-xs">No activity yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => {
        const actor = entry.actorUserId ? entry.actorUserId.slice(0, 8) : 'system';
        const isRestore = entry.action === 'page.version_restored';
        const versionsHref = `/pages/${pageId}` as Route;
        return (
          <li key={entry.id} className="rounded-md border p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{labelFor(entry.action)}</span>
              <span className="text-muted-foreground">{relativeTime(entry.createdAt)}</span>
            </div>
            <div className="text-muted-foreground mt-1 flex items-center gap-2 font-mono">
              <span>{actor}</span>
              {isRestore ? (
                <Link href={versionsHref} className="text-primary underline hover:no-underline">
                  view history
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
