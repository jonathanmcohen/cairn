'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = {
  connectorId: string;
  conflictId: string;
  resolution: 'cairn' | 'external';
  children: React.ReactNode;
};

/**
 * Posts JSON to the resolve route (the route expects content-type: application/json,
 * which a native form POST can't produce). Refreshes the page on success so the
 * resolved row disappears from the inbox.
 */
export function ResolveButton({ connectorId, conflictId, resolution, children }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/connectors/${connectorId}/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(
          typeof body.error === 'string' ? body.error : `request failed (${res.status})`,
        );
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
      >
        {busy ? '…' : children}
      </button>
      {err ? <span className="text-destructive text-xs">{err}</span> : null}
    </div>
  );
}
