'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyArchived } from '@/components/empty-state/variants';
import { InlineIcon } from '@/components/page-icon-inline';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.10.0 D5 — archived-pages list (mirrors `TrashList`). Per-row "Open"
 * navigates to the page (archived pages stay reachable by direct URL);
 * "Un-archive" drives the existing status route through the legal
 * archived → draft transition, so the audit row + collaborator notification
 * come for free. `canUnarchive=false` (viewer role) renders read-only.
 */
export type ArchivedItem = {
  id: string;
  title: string;
  icon: string | null;
  /** ISO timestamp — serialized across the RSC boundary. */
  archivedAt: string;
  /** Ancestor titles, root first (parent context; empty for root pages). */
  parents: string[];
};

export function ArchivedList({
  initialItems,
  canUnarchive,
}: {
  initialItems: ArchivedItem[];
  canUnarchive: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function unarchive(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/pages/${id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'draft' }),
    });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      router.refresh();
    } else {
      setError(t('archived.unarchiveError'));
    }
  }

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold">{t('archived.title')}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('archived.description')}</p>
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyArchived />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded border px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-lg">
                  <InlineIcon value={item.icon} />
                </span>
                <div className="min-w-0">
                  {/* B2 mirror: same untitled fallback as TrashList. */}
                  <div className="truncate font-medium">
                    {item.title.trim() || t('trash.untitled')}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.parents.length > 0 && <span>{item.parents.join(' / ')} · </span>}
                    {t('archived.archivedAt', {
                      date: new Date(item.archivedAt).toLocaleString(),
                    })}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/pages/${item.id}` as Route}>{t('archived.open')}</Link>
                </Button>
                {canUnarchive && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === item.id}
                    onClick={() => void unarchive(item.id)}
                  >
                    {t('archived.unarchive')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
