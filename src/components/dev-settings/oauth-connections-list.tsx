'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/lib/i18n/provider';

export type OauthConnectionRow = {
  /** oauth_tokens row id (used for the revoke call). */
  id: string;
  clientName: string;
  scopes: string[];
  lastUsedAt: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * v0.9.16 Plan F — Settings → Developer OAuth connections. Lists the signed-in
 * user's active OAuth grants (client name, scopes, last used) with a Revoke
 * button per row, mirroring the Active-Sessions list interaction (optimistic
 * removal). Revoke posts to a thin per-id DELETE wrapper.
 */
export function OauthConnectionsList({ initial }: { initial: OauthConnectionRow[] }) {
  const t = useT();
  const [rows, setRows] = useState<OauthConnectionRow[]>(initial);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setError(null);
    // Optimistic removal (Active-Sessions style).
    const prev = rows;
    setRows((cur) => cur.filter((r) => r.id !== id));
    const res = await fetch(`/api/dev/oauth-connections/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError('Could not revoke that connection.');
      setRows(prev);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('oauthConnections.heading')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">{t('oauthConnections.description')}</p>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('oauthConnections.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                data-connection-id={row.id}
                className="flex items-center justify-between gap-4 rounded border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{row.clientName}</p>
                  <p className="truncate text-muted-foreground text-xs">{row.scopes.join(', ')}</p>
                  <p className="text-muted-foreground text-xs">
                    {row.lastUsedAt
                      ? t('oauthConnections.lastUsed', { when: relativeTime(row.lastUsedAt) })
                      : t('oauthConnections.neverUsed')}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11 min-w-11 shrink-0"
                  onClick={() => revoke(row.id)}
                >
                  {t('oauthConnections.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
