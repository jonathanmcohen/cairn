'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * v0.9.0 G1 P8 — single passkey row + remove button.
 *
 * Encapsulates the DELETE call so the RSC page stays declarative. On
 * successful remove the page reloads.
 */
export function PasskeyListItem(props: {
  id: string;
  nickname: string | null;
  createdAt: string; // ISO
  lastUsedAt: string | null; // ISO or null
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    if (
      !window.confirm(
        `Remove this passkey${props.nickname ? ` (${props.nickname})` : ''}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/webauthn/credentials/${props.id}`, { method: 'DELETE' });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `remove failed: ${r.status}`);
      }
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center justify-between border-b py-2">
      <div>
        <p className="font-medium text-sm">{props.nickname ?? '(unnamed)'}</p>
        <p className="text-muted-foreground text-xs">
          Added {props.createdAt.slice(0, 10)}
          {props.lastUsedAt ? ` · last used ${props.lastUsedAt.slice(0, 10)}` : ' · never used'}
        </p>
        {err ? (
          <p className="text-destructive text-xs" role="alert">
            {err}
          </p>
        ) : null}
      </div>
      <Button variant="outline" size="sm" onClick={remove} disabled={busy}>
        {busy ? 'Removing…' : 'Remove'}
      </Button>
    </li>
  );
}
