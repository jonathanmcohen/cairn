'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';
import type { PeerSummary } from '@/lib/search/peer-admin';

export function FederatedManager({ peers }: { peers: PeerSummary[] }) {
  const t = useT();
  const router = useRouter();
  const nameId = useId();
  const urlId = useId();
  const secretId = useId();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addPeer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/federated/peers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, baseUrl, sharedSecret: secret }),
      });
      if (!res.ok) {
        setError(t('admin.federated.error'));
        return;
      }
      setName('');
      setBaseUrl('');
      setSecret('');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(peerId: string, enabled: boolean) {
    setError(null);
    setBusyId(peerId);
    try {
      const res = await fetch(`/api/admin/federated/peers/${peerId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        setError(t('admin.federated.error'));
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(peerId: string) {
    setError(null);
    setBusyId(peerId);
    try {
      const res = await fetch(`/api/admin/federated/peers/${peerId}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(t('admin.federated.error'));
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
        <h1 className="text-xl font-semibold">{t('admin.federated.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.federated.description')}</p>
      </header>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={addPeer} className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor={nameId} className="text-xs text-muted-foreground">
            {t('admin.federated.nameLabel')}
          </label>
          <input
            id={nameId}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </div>
        <div className="flex flex-col">
          <label htmlFor={urlId} className="text-xs text-muted-foreground">
            {t('admin.federated.baseUrlLabel')}
          </label>
          <input
            id={urlId}
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="rounded border px-2 py-1"
            placeholder="https://peer.example.com"
          />
        </div>
        <div className="flex flex-col">
          <label htmlFor={secretId} className="text-xs text-muted-foreground">
            {t('admin.federated.secretLabel')}
          </label>
          <input
            id={secretId}
            type="password"
            required
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? t('admin.federated.creating') : t('admin.federated.create')}
        </Button>
      </form>

      {peers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.federated.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {peers.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded border bg-card p-3">
              <div className="flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.baseUrl} ·{' '}
                  {p.enabled
                    ? t('admin.federated.statusEnabled')
                    : t('admin.federated.statusDisabled')}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId === p.id}
                onClick={() => toggle(p.id, !p.enabled)}
              >
                {p.enabled ? t('admin.federated.disable') : t('admin.federated.enable')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busyId === p.id}
                aria-label={`${t('admin.federated.remove')} ${p.name}`}
                onClick={() => remove(p.id)}
              >
                {t('admin.federated.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
