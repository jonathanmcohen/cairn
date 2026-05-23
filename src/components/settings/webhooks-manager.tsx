'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
};

export type DeliveryRow = {
  id: string;
  webhookId: string;
  event: string;
  status: string;
  lastStatus: number | null;
  attempts: number;
  createdAt: string;
};

type CreateResponse = {
  secret: string;
  webhook: WebhookRow;
};

const EVENTS = [
  'page.created',
  'page.updated',
  'page.deleted',
  'row.created',
  'row.updated',
  'row.deleted',
] as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function statusClass(status: string): string {
  if (status === 'success') return 'text-green-600 dark:text-green-400';
  if (status === 'failed') return 'text-destructive';
  return 'text-amber-600 dark:text-amber-400'; // pending
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function WebhooksManager({
  initialHooks,
  initialDeliveries,
}: {
  initialHooks: WebhookRow[];
  initialDeliveries: DeliveryRow[];
}) {
  const urlId = useId();

  const [hooks, setHooks] = useState<WebhookRow[]>(initialHooks);
  const [deliveries] = useState<DeliveryRow[]>(initialDeliveries);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Holds the plaintext secret AFTER creation — kept only in memory, discarded on close.
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  // Transient one-shot reveal of a newly-rotated secret. Cleared when the
  // operator clicks "I copied it" — the plaintext never persists past dismiss.
  const [rotatedSecret, setRotatedSecret] = useState<{ hookId: string; secret: string } | null>(
    null,
  );

  function resetForm() {
    setUrl('');
    setSelectedEvents([]);
    setError(null);
  }

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Cheap client-side check; the SSRF guard is authoritative at delivery time.
    if (!isHttpUrl(url.trim())) {
      setError('Enter a valid http(s) URL.');
      return;
    }
    if (selectedEvents.length === 0) {
      setError('Select at least one event.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events: selectedEvents }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as CreateResponse;
      setHooks((prev) => [{ ...data.webhook }, ...prev]);
      setNewSecret(data.secret); // shown once
      setCreating(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(hook: WebhookRow) {
    setTogglingId(hook.id);
    try {
      const res = await fetch(`/api/webhooks/${hook.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !hook.active }),
      });
      if (res.ok) {
        setHooks((prev) => prev.map((h) => (h.id === hook.id ? { ...h, active: !h.active } : h)));
      }
    } finally {
      setTogglingId(null);
    }
  }

  async function onRotate(hook: WebhookRow) {
    if (
      !confirm(
        'Rotate this webhook secret? Existing signed deliveries will stop verifying — receivers must adopt the new secret immediately.',
      )
    ) {
      return;
    }
    setRotatingId(hook.id);
    setError(null);
    try {
      const res = await fetch(`/api/webhooks/${hook.id}/rotate-secret`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Rotate failed (${res.status})`);
        return;
      }
      const { secret } = (await res.json()) as { secret: string };
      setRotatedSecret({ hookId: hook.id, secret });
    } finally {
      setRotatingId(null);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this webhook? Its delivery history will be removed too.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
      if (res.ok) setHooks((prev) => prev.filter((h) => h.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  async function copySecret() {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function dismissSecret() {
    setNewSecret(null); // discard plaintext from memory
    setCopied(false);
  }

  return (
    <div className="space-y-6">
      {/* Show-once panel for ROTATED secrets. Same one-shot reveal rule as
          the create flow — once dismissed, plaintext is gone for good. */}
      {rotatedSecret ? (
        <Card>
          <CardHeader>
            <CardTitle>New webhook signing secret</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-destructive">
              Rotated. Copy now — Cairn won&apos;t show it again. Existing receivers must adopt this
              secret immediately or signatures will start failing.
            </p>
            <code className="block break-all rounded border bg-muted px-3 py-2 font-mono text-sm">
              {rotatedSecret.secret}
            </code>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(rotatedSecret.secret).catch(() => {});
                }}
              >
                Copy
              </Button>
              <Button type="button" variant="outline" onClick={() => setRotatedSecret(null)}>
                I copied it
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Show-once panel: the signing secret is never retrievable again. */}
      {newSecret ? (
        <Card>
          <CardHeader>
            <CardTitle>Your webhook signing secret</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-destructive">
              Copy this secret now — it signs your deliveries and won&apos;t be shown again.
            </p>
            <code className="block break-all rounded border bg-muted px-3 py-2 font-mono text-sm">
              {newSecret}
            </code>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void copySecret()}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button type="button" variant="outline" onClick={dismissSecret}>
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
            onClick={() => {
              setCreating(true);
              setNewSecret(null);
            }}
          >
            Add webhook
          </Button>
        )}
      </div>

      {/* Create form (controlled panel — no Dialog primitive in this repo). */}
      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle>Add webhook</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => void onCreate(e)}>
              <div className="space-y-1.5">
                <Label htmlFor={urlId}>Endpoint URL</Label>
                <Input
                  id={urlId}
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/hooks/cairn"
                  required
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Events</legend>
                <div className="grid grid-cols-2 gap-2">
                  {EVENTS.map((event) => (
                    <label key={event} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(event)}
                        onChange={() => toggleEvent(event)}
                        className="size-4 rounded border-input"
                      />
                      <span className="font-mono">{event}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || url.trim().length === 0}>
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

      {hooks.length === 0 ? (
        <p className="text-muted-foreground">No webhooks yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium">Events</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {hooks.map((h) => (
                <tr key={h.id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2 font-mono text-xs break-all">{h.url}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {h.events.map((event) => (
                        <span
                          key={event}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
                        >
                          {event}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={togglingId === h.id}
                      onClick={() => void onToggle(h)}
                    >
                      {h.active ? 'On' : 'Off'}
                    </Button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="sm" asChild>
                        <a href={`/settings/admin/webhooks/${h.id}/deliveries`}>Deliveries</a>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rotatingId === h.id}
                        onClick={() => void onRotate(h)}
                      >
                        {rotatingId === h.id ? 'Rotating…' : 'Rotate secret'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={deletingId === h.id}
                        onClick={() => void onDelete(h.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Recent deliveries</h2>
        {deliveries.length === 0 ? (
          <p className="text-muted-foreground">No deliveries yet.</p>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">HTTP</th>
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{d.event}</td>
                    <td className={`px-3 py-2 font-medium ${statusClass(d.status)}`}>{d.status}</td>
                    <td className="px-3 py-2 text-muted-foreground">{d.lastStatus ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{d.attempts}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
