'use client';

import QRCode from 'qrcode';
import { useState } from 'react';
import { RecoveryCodesCard } from '@/components/security/recovery-codes-card';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

type EnrollData = { secret: string; otpauthUri: string; recoveryCodes: string[] };

export function TwoFactorCard({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const t = useT();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [enroll, setEnroll] = useState<EnrollData | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setError(null);
    const r = await fetch('/api/auth/2fa/enroll', { method: 'POST' });
    if (!r.ok) return setError('Could not start enrollment.');
    const data = (await r.json()) as EnrollData;
    setEnroll(data);
    setQr(await QRCode.toDataURL(data.otpauthUri));
  }

  async function confirm() {
    setError(null);
    const r = await fetch('/api/auth/2fa/enroll', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!r.ok) return setError('That code was not valid. Try again.');
    setEnabled(true);
    setEnroll(null);
    setQr(null);
    setToken('');
  }

  async function disable() {
    setError(null);
    const r = await fetch('/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: disableCode }),
    });
    if (!r.ok) return setError('Enter a valid code or recovery code to disable.');
    setEnabled(false);
    setDisableCode('');
  }

  if (enabled) {
    return (
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Two-factor authentication is on</h2>
        <p className="text-muted-foreground text-sm">
          Enter a current code or a recovery code to turn it off.
        </p>
        <div className="space-y-1">
          <label htmlFor="2fa-disable-code" className="block text-sm font-medium">
            {t('security.twoFactor.disableLabel')}
          </label>
          <input
            id="2fa-disable-code"
            className="w-48 rounded border px-2 py-1"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456 or recovery"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
          />
        </div>
        <Button variant="destructive" onClick={() => void disable()}>
          Disable 2FA
        </Button>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <RecoveryCodesCard />
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">Two-factor authentication</h2>
      {!enroll ? (
        <>
          <p className="text-muted-foreground text-sm">
            Protect your account with an authenticator app.
          </p>
          <Button variant="default" onClick={() => void begin()}>
            {t('security.twoFactor.setup')}
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          {qr && (
            // biome-ignore lint/performance/noImgElement: data-URL QR, not a remote asset
            <img alt="Scan this QR code" className="size-44" src={qr} />
          )}
          <details>
            <summary className="cursor-pointer text-sm">Can&apos;t scan? Enter this key</summary>
            <code className="break-all text-xs">{enroll.secret}</code>
          </details>
          <div>
            <p className="font-medium text-sm">Recovery codes (save these now — shown once):</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
              {enroll.recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-1">
            <label htmlFor="2fa-confirm-code" className="block text-sm font-medium">
              {t('security.twoFactor.confirmLabel')}
            </label>
            <input
              id="2fa-confirm-code"
              className="w-48 rounded border px-2 py-1"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <Button onClick={() => void confirm()}>Confirm &amp; enable</Button>
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}
