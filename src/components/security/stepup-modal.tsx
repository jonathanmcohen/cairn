'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * v0.9.0 G1 P8 — step-up modal.
 *
 * Renders inline when a sensitive-op fetch returns 403 + code 'stepup-required'.
 * Drives the WebAuthn assertion ceremony, then resolves so the caller can
 * retry the original request with the fresh stepUpAt claim.
 *
 * Dual-path refresh after a successful assertion:
 *   1. The `cairn_stepup` cookie set by `/api/webauthn/assert` covers the
 *      immediate same-request retry (e.g. workspace-delete) on servers that
 *      honor the cookie alongside the JWT claim.
 *   2. `session.update({ stepUpAt })` round-trips the NextAuth JWT so any
 *      subsequent server request that reads `stepUpAt` from the token sees
 *      the fresh timestamp. If `<SessionProvider>` is absent the call is a
 *      no-op and path (1) still keeps the retry working.
 */
export function StepUpModal({
  open,
  onOpenChange,
  onComplete,
  onCancel,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onComplete: () => void | Promise<void>;
  onCancel?: () => void;
}): React.JSX.Element | null {
  const { update } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (open === false) return null;

  function cancel() {
    onOpenChange?.(false);
    onCancel?.();
  }

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const optsRes = await fetch('/api/webauthn/assert-options', { method: 'POST' });
      if (!optsRes.ok) {
        const body = (await optsRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'options fetch failed');
      }
      const { options } = (await optsRes.json()) as {
        options: PublicKeyCredentialRequestOptionsJSON;
      };
      const response = await startAuthentication({ optionsJSON: options });
      const r = await fetch('/api/webauthn/assert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `assert failed: ${r.status}`);
      }
      await update({ stepUpAt: Date.now() });
      await onComplete();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cairn-stepup-title"
      className="fixed inset-0 flex items-center justify-center bg-black/50"
    >
      <div className="w-96 space-y-3 rounded bg-background p-6 shadow-md">
        <h2 id="cairn-stepup-title" className="font-semibold text-lg">
          Confirm with your passkey
        </h2>
        <p className="text-muted-foreground text-sm">
          This action requires a recent passkey assertion (within 5 minutes).
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy}>
            {busy ? 'Verifying…' : 'Use passkey'}
          </Button>
        </div>
        {err ? (
          <p className="text-destructive text-sm" role="alert">
            {err}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type PublicKeyCredentialRequestOptionsJSON = Parameters<
  typeof startAuthentication
>[0]['optionsJSON'];
