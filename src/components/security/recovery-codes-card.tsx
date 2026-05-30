'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * Shows how many recovery codes remain and lets the user regenerate the set.
 * Regenerating returns plaintext ONCE (the codes are stored hashed and can
 * never be redisplayed), so we surface them inline with a one-time warning
 * and gate the action behind a confirm (it invalidates the previous set).
 * Only meaningful when 2FA is enabled; the POST 409s otherwise.
 */
export function RecoveryCodesCard() {
  const t = useT();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/2fa/recovery-codes');
        if (!res.ok) return;
        const data = (await res.json()) as { remaining: number };
        if (active) setRemaining(data.remaining);
      } catch {
        // best-effort; the count is informational
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function regenerate() {
    if (!window.confirm(t('security.recoveryCodes.confirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/2fa/recovery-codes', { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { recoveryCodes: string[] };
      setCodes(data.recoveryCodes);
      setRemaining(data.recoveryCodes.length);
    } catch {
      setError(t('security.recoveryCodes.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">{t('security.recoveryCodes.title')}</h2>
      <p className="text-muted-foreground text-sm">
        {remaining === null
          ? t('security.recoveryCodes.loading')
          : t('security.recoveryCodes.remaining', { count: remaining, remaining })}
      </p>
      {codes && (
        <div>
          <p className="font-medium text-sm">{t('security.recoveryCodes.savePrompt')}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <Button
        variant="default"
        className="min-h-11"
        disabled={busy}
        onClick={() => void regenerate()}
      >
        {t('security.recoveryCodes.regenerate')}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}
