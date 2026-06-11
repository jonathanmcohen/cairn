'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { CopyButton } from '@/components/settings/copy-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/provider';

type CreatedClient = {
  clientId: string;
  /** One-time plaintext — null for public (PKCE-only) clients. */
  clientSecret: string | null;
};

/**
 * Post-v0.10.0 — manual OAuth client provisioning ("Create client" card on
 * /settings/admin/oauth-clients). The instance runs on a LAN; some MCP
 * clients can't reach (or don't support) RFC 7591 dynamic registration, so an
 * admin mints client_id/client_secret pairs here and pastes them into the
 * client's config. On success the credentials render in a SHOW-ONCE panel
 * (same posture as the G5 registration-lock token): the plaintext secret
 * lives only in component state until the next mutation or navigation —
 * never logged, never persisted, never re-fetchable.
 *
 * The client-type picker is two aria-pressed toggle buttons — the repo bans
 * raw native pickers (no literal `<select` in src/).
 */
export function CreateClientCard() {
  const t = useT();
  const router = useRouter();
  const nameId = useId();
  const urisId = useId();
  const [name, setName] = useState('');
  const [uris, setUris] = useState('');
  const [confidential, setConfidential] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedClient | null>(null);

  async function onSubmit(): Promise<void> {
    const redirectUris = uris
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (name.trim().length === 0 || redirectUris.length === 0) {
      setError(t('admin.oauthClients.create.invalid'));
      return;
    }
    setError(null);
    setCreated(null);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/oauth-clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientName: name.trim(), redirectUris, confidential }),
      });
      if (res.status === 400) {
        setError(t('admin.oauthClients.create.invalid'));
        return;
      }
      if (!res.ok) {
        setError(t('admin.oauthClients.error'));
        return;
      }
      const body = (await res.json()) as {
        client: { clientId: string };
        clientSecret: string | null;
      };
      setCreated({ clientId: body.client.clientId, clientSecret: body.clientSecret });
      setName('');
      setUris('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="oauth-create-card" className="space-y-3 rounded border bg-card p-4">
      <div>
        <h2 className="font-medium">{t('admin.oauthClients.create.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('admin.oauthClients.create.description')}
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      {created ? (
        <div data-testid="oauth-created-panel" className="space-y-2 rounded border bg-muted/50 p-3">
          <p className="text-sm font-medium">
            {created.clientSecret
              ? t('admin.oauthClients.showOnce.note')
              : t('admin.oauthClients.showOnce.publicNote')}
          </p>
          <div className="flex items-center gap-1 text-xs">
            <span className="shrink-0 text-muted-foreground">
              {t('admin.oauthClients.colClientId')}:
            </span>
            <code data-testid="oauth-created-client-id" className="min-w-0 break-all font-mono">
              {created.clientId}
            </code>
            <CopyButton value={created.clientId} label={t('admin.oauthClients.copyClientId')} />
          </div>
          {created.clientSecret ? (
            <div className="flex items-center gap-1 text-xs">
              <span className="shrink-0 text-muted-foreground">
                {t('admin.oauthClients.showOnce.secretLabel')}:
              </span>
              <code data-testid="oauth-created-secret" className="min-w-0 break-all font-mono">
                {created.clientSecret}
              </code>
              <CopyButton
                value={created.clientSecret}
                label={t('admin.oauthClients.showOnce.copySecret')}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor={nameId}>{t('admin.oauthClients.create.nameLabel')}</Label>
        <Input
          id={nameId}
          value={name}
          maxLength={100}
          disabled={busy}
          placeholder={t('admin.oauthClients.create.namePlaceholder')}
          data-testid="oauth-create-name"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={urisId}>{t('admin.oauthClients.create.urisLabel')}</Label>
        <textarea
          id={urisId}
          value={uris}
          rows={3}
          disabled={busy}
          placeholder={t('admin.oauthClients.create.urisPlaceholder')}
          data-testid="oauth-create-uris"
          className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
          onChange={(e) => setUris(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('admin.oauthClients.create.urisHint')}</p>
      </div>

      <div className="space-y-1">
        <span className="text-sm font-medium">{t('admin.oauthClients.create.typeLabel')}</span>
        {/* Two self-labelled toggle buttons (aria-pressed) — no native select. */}
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={confidential ? 'default' : 'outline'}
            aria-pressed={confidential}
            disabled={busy}
            className="min-h-11"
            data-testid="oauth-create-type-confidential"
            onClick={() => setConfidential(true)}
          >
            {t('admin.oauthClients.create.typeConfidential')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={confidential ? 'outline' : 'default'}
            aria-pressed={!confidential}
            disabled={busy}
            className="min-h-11"
            data-testid="oauth-create-type-public"
            onClick={() => setConfidential(false)}
          >
            {t('admin.oauthClients.create.typePublic')}
          </Button>
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        className="min-h-11"
        disabled={busy}
        data-testid="oauth-create-submit"
        onClick={() => void onSubmit()}
      >
        {t('admin.oauthClients.create.submit')}
      </Button>
    </section>
  );
}
