'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  deliveryId: string;
  webhookId: string;
  webhookUrl: string;
  /** The exact canonical JSON body that was signed over server-side. */
  canonicalBody: string;
  /** `sha256=<hex>` — pre-computed server-side from the stored secret. */
  signature: string;
  /** Event name to populate the X-Cairn-Event header in the curl. */
  event: string;
};

/**
 * Per-row actions for the per-webhook deliveries dashboard. Two buttons:
 * - **Replay** — POSTs to the replay route; the server re-enqueues the row.
 * - **Copy as curl** — synthesizes a `curl` command (URL + headers + body) that
 *   any operator can paste into a terminal to reproduce the delivery. The
 *   signature is pre-computed server-side so the webhook secret never reaches
 *   the browser.
 */
export function WebhookDeliveryRowActions({
  deliveryId,
  webhookId,
  webhookUrl,
  canonicalBody,
  signature,
  event,
}: Props) {
  const [replaying, setReplaying] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onReplay() {
    setReplaying(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/webhooks/${webhookId}/deliveries/${deliveryId}/replay`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(typeof body.error === 'string' ? body.error : `failed (${res.status})`);
      } else {
        setReplayed(true);
        setTimeout(() => setReplayed(false), 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'replay failed');
    } finally {
      setReplaying(false);
    }
  }

  function onCopyCurl() {
    // Single-line curl. Body is the canonical JSON we signed over server-side.
    const escapedBody = canonicalBody.replace(/'/g, "'\\''");
    const curl =
      `curl -X POST '${webhookUrl}' ` +
      `-H 'Content-Type: application/json' ` +
      `-H 'X-Cairn-Signature: ${signature}' ` +
      `-H 'X-Cairn-Event: ${event}' ` +
      `-d '${escapedBody}'`;
    void navigator.clipboard.writeText(curl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setError('clipboard write failed'),
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void onReplay()}
        disabled={replaying}
      >
        {replaying ? 'Replaying…' : replayed ? 'Enqueued' : 'Replay'}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCopyCurl}>
        {copied ? 'Copied!' : 'Copy as curl'}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
