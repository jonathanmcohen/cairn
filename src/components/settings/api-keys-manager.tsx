'use client';

import { KeyRound } from 'lucide-react';
import { useId, useState } from 'react';
import { EmptyState } from '@/components/empty-state/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

export type ApiKeyRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  role: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type CreateResponse = {
  token: string;
  key: {
    id: string;
    name: string;
    tokenPrefix: string;
    role: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
  };
};

const ROLES = ['admin', 'editor', 'viewer'] as const;

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export function ApiKeysManager({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const t = useT();
  const confirm = useConfirm();
  const nameId = useId();
  const roleId = useId();
  const expiryId = useId();

  const [keys, setKeys] = useState<ApiKeyRow[]>(initialKeys);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('editor');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Holds the plaintext token AFTER creation — kept only in memory and discarded on close.
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  function resetForm() {
    setName('');
    setRole('editor');
    setExpiresInDays('');
    setError(null);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          role,
          ...(days && Number.isFinite(days) ? { expiresInDays: days } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as CreateResponse;
      setKeys((prev) => [{ ...data.key }, ...prev]);
      setNewToken(data.token); // shown once
      setCreating(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    const ok = await confirm({
      title: 'Revoke this key? Requests using it will immediately stop working.',
      confirmLabel: 'Revoke',
      variant: 'danger',
    });
    if (!ok) return;
    setRevoking(id);
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      if (res.ok) setKeys((prev) => prev.filter((k) => k.id !== id));
    } finally {
      setRevoking(null);
    }
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function dismissToken() {
    setNewToken(null); // discard plaintext from memory
    setCopied(false);
  }

  return (
    <div className="space-y-6">
      {/* Show-once panel: the plaintext token is never retrievable again. */}
      {newToken ? (
        <Card>
          <CardHeader>
            <CardTitle>Your new API key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-destructive">
              Copy this now — it won&apos;t be shown again. Only its prefix is stored.
            </p>
            <code className="block break-all rounded border bg-muted px-3 py-2 font-mono text-sm">
              {newToken}
            </code>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void copyToken()}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button type="button" variant="outline" onClick={dismissToken}>
                Done
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-end">
        {creating ? null : (
          <Button
            type="button"
            variant="default"
            className="min-h-11"
            onClick={() => {
              setCreating(true);
              setNewToken(null);
            }}
          >
            Create key
          </Button>
        )}
      </div>

      {/* Create form (controlled panel — no Dialog primitive in this repo). */}
      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle>Create API key</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => void onCreate(e)}>
              <div className="space-y-1.5">
                <Label htmlFor={nameId}>Name</Label>
                <Input
                  id={nameId}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. CI deploy bot"
                  required
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={roleId}>Role</Label>
                <Select
                  value={role}
                  onValueChange={(next) => setRole(next as (typeof ROLES)[number])}
                >
                  <SelectTrigger id={roleId} aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={expiryId}>Expires in (days, optional)</Label>
                <Input
                  id={expiryId}
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  placeholder="Never"
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || name.trim().length === 0}>
                  {busy ? 'Creating…' : 'Create'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setCreating(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound aria-hidden="true" />}
          headline={t('apiKeys.empty.headline')}
          guidance={t('apiKeys.empty.guidance')}
          ctaLabel={t('apiKeys.empty.cta')}
          ctaHref="/settings/developer/tokens"
        />
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Prefix</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{k.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{k.tokenPrefix}…</td>
                  <td className="px-3 py-2">{k.role}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(k.lastUsedAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(k.expiresAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 min-w-11 text-destructive hover:text-destructive"
                      disabled={revoking === k.id}
                      onClick={() => void onRevoke(k.id)}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
