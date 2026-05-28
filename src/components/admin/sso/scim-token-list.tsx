'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ScimTokenRow = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export function ScimTokenList({ initial }: { initial: ScimTokenRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<ScimTokenRow[]>(initial);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedRaw, setRevealedRaw] = useState<string | null>(null);

  async function onMint(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sso/scim-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
        }),
      });
      if (!res.ok) throw new Error(`Mint failed (${res.status})`);
      const body = (await res.json()) as { id: string; raw: string };
      setRevealedRaw(body.raw);
      setNewName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mint failed');
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sso/scim-tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Revoke failed (${res.status})`);
      setRows((r) => r.filter((row) => row.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {revealedRaw ? (
        <div className="rounded border bg-amber-50 p-3 text-sm dark:bg-amber-950">
          <p className="font-medium">New SCIM token (copy now — won't be shown again)</p>
          <code className="mt-1 block break-all font-mono text-xs">{revealedRaw}</code>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setRevealedRaw(null)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
      <form onSubmit={onMint} className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="scim-token-name">New token name</Label>
          <Input
            id="scim-token-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Okta SCIM"
            required
          />
        </div>
        <Button type="submit" disabled={busy || newName.trim().length === 0}>
          {busy ? 'Working…' : 'Mint'}
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SCIM tokens minted yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 rounded border bg-card p-3">
              <div className="flex-1">
                <div className="font-medium">{row.name}</div>
                <div className="text-xs text-muted-foreground">
                  Created {new Date(row.createdAt).toLocaleString()}
                  {row.lastUsedAt
                    ? ` · Last used ${new Date(row.lastUsedAt).toLocaleString()}`
                    : ' · Never used'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Scopes: {row.scopes.join(', ')}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void onRevoke(row.id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
