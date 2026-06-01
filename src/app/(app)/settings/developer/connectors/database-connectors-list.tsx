'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useT } from '@/lib/i18n/provider';

export type ConnectorRow = {
  id: string;
  kind: string;
  databaseId: string;
  databaseName: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  unresolvedConflicts: number;
};

const KIND_KEY: Record<string, string> = {
  google_sheets: 'connectorsDb.create.kind.google_sheets',
  airtable: 'connectorsDb.create.kind.airtable',
  csv: 'connectorsDb.create.kind.csv',
};

export function DatabaseConnectorsList({ connectors }: { connectors: ConnectorRow[] }) {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function onDelete(id: string): Promise<void> {
    const ok = await confirm({
      title: t('connectorsDb.delete.confirmTitle'),
      description: t('connectorsDb.delete.confirmBody'),
      confirmLabel: t('connectorsDb.delete.confirm'),
      cancelLabel: t('connectorsDb.delete.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/connectors/${id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold">{t('connectorsDb.heading')}</h2>
        <p className="text-muted-foreground text-sm">{t('connectorsDb.subtitle')}</p>
      </header>

      {connectors.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('connectorsDb.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {connectors.map((c) => {
            const configHref = `/settings/developer/connectors/${c.id}` as Route;
            const conflictsHref = `/settings/developer/connectors/${c.id}/conflicts` as Route;
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <div className="font-medium">{t(KIND_KEY[c.kind] ?? c.kind)}</div>
                  <div className="text-muted-foreground text-xs">
                    <span>{c.databaseName}</span>
                    {' · '}
                    <span>
                      {c.enabled
                        ? t('connectorsDb.status.enabled')
                        : t('connectorsDb.status.disabled')}
                    </span>
                    {' · '}
                    <span>
                      {c.lastSyncedAt
                        ? new Date(c.lastSyncedAt).toLocaleDateString()
                        : t('connectorsDb.neverSynced')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={conflictsHref}
                    className="text-sm underline hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('connectorsDb.conflicts', { count: c.unresolvedConflicts })}
                  </Link>
                  <Link
                    href={configHref}
                    className="text-sm underline hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('connectorsDb.configure')}
                  </Link>
                  <Button
                    variant="outline"
                    className="min-h-9"
                    disabled={deleting === c.id}
                    onClick={() => onDelete(c.id)}
                  >
                    {t('connectorsDb.delete')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
