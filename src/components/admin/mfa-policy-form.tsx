'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * v0.9.0 G1 P8 — workspace MFA enforcement policy editor.
 *
 * Admin-only client form. Renders the require_mfa toggle + methods
 * checkboxes; saves via PUT /api/admin/workspaces/:id/mfa-policy.
 */
export function MfaPolicyForm({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: { requireMfa: boolean; methods: Array<'totp' | 'webauthn'> };
}): React.JSX.Element {
  const [requireMfa, setRequireMfa] = useState(initial.requireMfa);
  const [methods, setMethods] = useState<Set<'totp' | 'webauthn'>>(new Set(initial.methods));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleMethod(m: 'totp' | 'webauthn'): void {
    setMethods((curr) => {
      const next = new Set(curr);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      if (methods.size === 0) throw new Error('Select at least one method');
      const r = await fetch(`/api/admin/workspaces/${workspaceId}/mfa-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requireMfa, methods: [...methods] }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `save failed: ${r.status}`);
      }
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={requireMfa}
          onChange={(e) => setRequireMfa(e.target.checked)}
          disabled={busy}
        />
        <span>Require MFA enrollment for all members</span>
      </label>
      <fieldset className="space-y-2">
        <legend className="font-medium text-sm">Accepted methods</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={methods.has('totp')}
            onChange={() => toggleMethod('totp')}
            disabled={busy}
          />
          <span>TOTP (authenticator app)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={methods.has('webauthn')}
            onChange={() => toggleMethod('webauthn')}
            disabled={busy}
          />
          <span>WebAuthn (passkey / hardware key)</span>
        </label>
      </fieldset>
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save policy'}
        </Button>
        {saved ? <span className="text-muted-foreground text-sm">Saved.</span> : null}
        {err ? (
          <span className="text-destructive text-sm" role="alert">
            {err}
          </span>
        ) : null}
      </div>
    </div>
  );
}
