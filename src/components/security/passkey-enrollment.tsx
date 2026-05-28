'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * v0.9.0 G1 P8 — passkey enrollment driver.
 *
 * Renders the "Add a passkey" form. On click, fetches options, drives the
 * browser's WebAuthn create() ceremony, POSTs the result. The page reloads
 * on success so the RSC re-renders the credential list.
 */
export function PasskeyEnrollment() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');

  async function enroll() {
    setBusy(true);
    setErr(null);
    try {
      const optsRes = await fetch('/api/webauthn/register-options', { method: 'POST' });
      if (!optsRes.ok) {
        const body = (await optsRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'options fetch failed');
      }
      const { options } = (await optsRes.json()) as {
        options: PublicKeyCredentialCreationOptionsJSON;
      };
      const response = await startRegistration({ optionsJSON: options });
      const regRes = await fetch('/api/webauthn/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response, nickname: nickname || null }),
      });
      if (!regRes.ok) {
        const body = (await regRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `register failed: ${regRes.status}`);
      }
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded border p-4">
      <label className="block">
        <span className="font-medium text-sm">Nickname (optional)</span>
        <input
          className="mt-1 block w-full rounded border p-2"
          placeholder="e.g. YubiKey 5C"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          disabled={busy}
        />
      </label>
      <Button onClick={enroll} disabled={busy}>
        {busy ? 'Enrolling…' : 'Add a passkey'}
      </Button>
      {err ? (
        <p className="text-destructive text-sm" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

// Re-declare the JSON-options type locally to avoid pulling
// @simplewebauthn/server (a server-only dep) into the client bundle.
type PublicKeyCredentialCreationOptionsJSON = Parameters<
  typeof startRegistration
>[0]['optionsJSON'];
