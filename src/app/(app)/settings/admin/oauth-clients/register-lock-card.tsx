'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyButton } from '@/components/settings/copy-button';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.10.0 G5 — "Registration lock" card on the D3 OAuth-clients admin page.
 *
 * Default OPEN: RFC 7591 dynamic registration stays zero-setup for MCP
 * clients. Locking mints an RFC 7591 §3.1.1 initial access token that is
 * shown EXACTLY ONCE in the copyable block below (only its hash is stored —
 * the server cannot show it again, hence the "store this now" warning).
 * "Regenerate token" re-locks with a fresh token; unlocking deletes the lock
 * state entirely. Mutations go through POST
 * /api/admin/oauth-clients/register-lock (same fetch-then-router.refresh
 * pattern as the per-row delete in oauth-clients-view.tsx).
 */
export function RegisterLockCard({ locked }: { locked: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The one-time plaintext, held only in component state until dismissed by
  // the next mutation or navigation. Never logged, never persisted.
  const [mintedToken, setMintedToken] = useState<string | null>(null);

  async function mutate(nextLocked: boolean): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/oauth-clients/register-lock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locked: nextLocked }),
      });
      if (!res.ok) {
        setError(t('admin.oauthClients.lock.error'));
        return;
      }
      const body = (await res.json()) as { locked: boolean; initialAccessToken?: string };
      setMintedToken(body.initialAccessToken ?? null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="register-lock-card" className="space-y-3 rounded border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">{t('admin.oauthClients.lock.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('admin.oauthClients.lock.description')}
          </p>
        </div>
        <span
          data-testid="register-lock-state"
          className="shrink-0 rounded border px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          {locked
            ? t('admin.oauthClients.lock.stateLocked')
            : t('admin.oauthClients.lock.stateOpen')}
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      {mintedToken ? (
        <div data-testid="register-lock-token" className="space-y-2 rounded border bg-muted/50 p-3">
          <p className="text-sm font-medium">{t('admin.oauthClients.lock.tokenWarning')}</p>
          <div className="flex items-center gap-1">
            <code className="min-w-0 break-all font-mono text-xs">{mintedToken}</code>
            <CopyButton value={mintedToken} label={t('admin.oauthClients.lock.copyToken')} />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {locked ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="register-lock-regenerate"
              disabled={busy}
              onClick={() => void mutate(true)}
            >
              {t('admin.oauthClients.lock.regenerate')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="register-lock-disable"
              disabled={busy}
              onClick={() => void mutate(false)}
            >
              {t('admin.oauthClients.lock.disable')}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="register-lock-enable"
            disabled={busy}
            onClick={() => void mutate(true)}
          >
            {t('admin.oauthClients.lock.enable')}
          </Button>
        )}
      </div>
    </section>
  );
}
