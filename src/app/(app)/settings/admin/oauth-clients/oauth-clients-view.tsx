'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyButton } from '@/components/settings/copy-button';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useT } from '@/lib/i18n/provider';

export type OauthClientRow = {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  confidential: boolean;
  createdAt: string;
  activeGrants: number;
  totalGrants: number;
};

/**
 * v0.10.0 D3 — instance OAuth client-application registry (admin/owner-only).
 * Per-row Delete deregisters the app AND revokes every token issued to it; the
 * confirm copy carries that destructive consequence. The subtitle pins the
 * operator-confusion trap: these rows are registered client APPLICATIONS,
 * distinct from the per-user grant connections under Developer settings.
 */
export function OauthClientsView({ clients }: { clients: OauthClientRow[] }) {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(client: OauthClientRow): Promise<void> {
    const ok = await confirm({
      title: t('admin.oauthClients.deleteConfirmTitle'),
      description: t('admin.oauthClients.deleteConfirmBody', { name: client.name }),
      confirmLabel: t('admin.oauthClients.deleteConfirm'),
      cancelLabel: t('admin.oauthClients.deleteCancel'),
      variant: 'danger',
    });
    if (!ok) return;
    setError(null);
    setBusyId(client.id);
    try {
      const res = await fetch(`/api/admin/oauth-clients/${client.id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(t('admin.oauthClients.error'));
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{t('admin.oauthClients.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.oauthClients.description')}</p>
      </header>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="oauth-clients-empty">
          {t('admin.oauthClients.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {clients.map((c) => (
            <li
              key={c.id}
              data-testid="oauth-client-row"
              className="flex items-start gap-3 rounded border bg-card p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                    {c.confidential
                      ? t('admin.oauthClients.confidential')
                      : t('admin.oauthClients.public')}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>{t('admin.oauthClients.colClientId')}:</span>
                  <code className="max-w-48 truncate font-mono" title={c.clientId}>
                    {c.clientId}
                  </code>
                  <CopyButton value={c.clientId} label={t('admin.oauthClients.copyClientId')} />
                </div>
                <div className="break-all text-xs text-muted-foreground">
                  {t('admin.oauthClients.colRedirectUris')}: {c.redirectUris.join(', ')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('admin.oauthClients.colCreated')}: {new Date(c.createdAt).toLocaleDateString()}{' '}
                  ·{' '}
                  <span data-testid="oauth-client-grants">
                    {t('admin.oauthClients.activeGrants', { count: c.activeGrants })}
                  </span>{' '}
                  ({t('admin.oauthClients.totalGrants', { total: c.totalGrants })})
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="oauth-client-delete"
                disabled={busyId === c.id}
                aria-label={`${t('admin.oauthClients.delete')} ${c.name}`}
                onClick={() => void onDelete(c)}
              >
                {t('admin.oauthClients.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
