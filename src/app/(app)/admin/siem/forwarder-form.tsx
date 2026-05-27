'use client';

/**
 * v0.9.0 G8 P39 — SIEM forwarder create form (Client Component).
 *
 * Submits to `/api/admin/siem` (POST). Reloads the page on success so the
 * RSC re-renders the new row. Edit + delete + test interactions live in
 * later iterations / per-row controls; this initial form covers the create
 * path that the API + page render exercise.
 */

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Kind = 'syslog' | 'http';

export function ForwarderForm() {
  const [kind, setKind] = useState<Kind>('http');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [credentialSecret, setCredentialSecret] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const body: Record<string, unknown> = {
        kind,
        name,
        endpoint,
        enabled,
      };
      if (credentialSecret) body.credentialSecret = credentialSecret;
      const res = await fetch('/api/admin/siem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await res.text()) || res.statusText);
        return;
      }
      // Reload so the RSC re-renders the new row.
      window.location.reload();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border p-4">
      <div className="space-y-1">
        <Label htmlFor="siem-kind">Kind</Label>
        <select
          id="siem-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="block min-h-11 w-full rounded border bg-background px-3"
          aria-describedby="siem-kind-help"
        >
          <option value="http">HTTP webhook</option>
          <option value="syslog">Syslog (RFC 5424)</option>
        </select>
        <p id="siem-kind-help" className="text-xs text-muted-foreground">
          Choose <code>http</code> for a generic JSON-POST webhook, or <code>syslog</code> for an
          RFC 5424 UDP/TCP endpoint.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="siem-name">Name</Label>
        <Input
          id="siem-name"
          value={name}
          required
          minLength={1}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="siem-endpoint">Endpoint</Label>
        <Input
          id="siem-endpoint"
          value={endpoint}
          required
          placeholder={
            kind === 'http' ? 'https://siem.example.com/cairn-hook' : 'udp://127.0.0.1:514'
          }
          onChange={(e) => setEndpoint(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="siem-credential">
          Credential secret <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="siem-credential"
          type="password"
          autoComplete="off"
          value={credentialSecret}
          onChange={(e) => setCredentialSecret(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          HTTP targets send this as <code>Authorization: Bearer &lt;value&gt;</code>. Stored
          server-side and never re-displayed.
        </p>
      </div>

      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4"
        />
        Enabled
      </label>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? 'Saving…' : 'Add forwarder'}
      </Button>
    </form>
  );
}
