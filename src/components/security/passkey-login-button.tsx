'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.9.6 G8 — passwordless sign-in driver for the login page.
 *
 * Given the email already typed into the login form, it: POSTs to
 * /api/webauthn/login-options (204 ⇒ "no passkey for this email"), drives the
 * browser's WebAuthn assertion, POSTs the result to /api/webauthn/login-verify
 * for a signed ticket, then calls next-auth `signIn('passkey', { ticket })`.
 * On success it invokes `onSuccess` so the parent can route onward.
 */
export function PasskeyLoginButton({
  email,
  onSuccess,
}: {
  email: string;
  onSuccess: () => void;
}): React.JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const optsRes = await fetch('/api/webauthn/login-options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (optsRes.status === 204) {
        setErr(t('login.passkey.none'));
        return;
      }
      if (!optsRes.ok) throw new Error(t('login.passkey.optionsError'));
      const { options } = (await optsRes.json()) as {
        options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
      };
      const response = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch('/api/webauthn/login-verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!verifyRes.ok) throw new Error(t('login.passkey.verifyError'));
      const { ticket } = (await verifyRes.json()) as { ticket: string };
      const res = await signIn('passkey', { ticket, redirect: false });
      if (res?.error) throw new Error(t('login.passkey.signinError'));
      onSuccess();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={run}
        disabled={busy || !email}
      >
        {busy ? t('login.passkey.waiting') : t('login.passkey.signin')}
      </Button>
      {err ? (
        <p className="text-destructive text-sm" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
