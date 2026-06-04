'use client';

import { useEffect, useState } from 'react';
import { EncryptionDisabledNotice } from '@/components/admin/encryption-disabled-notice';
import { Button } from '@/components/ui/button';
import { usePrompt } from '@/components/ui/input-dialog';
import { enrollKeypair, ensureEnrolled } from '@/lib/e2e/enroll-client';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.9.7 G21 (#168) — E2E key enrollment card.
 *
 * Generates the caller's X25519 keypair, seals it under a passphrase the
 * server never sees, persists the sealed material, and caches it locally.
 * Surfaced on Security settings and as the onboarding prompt when a workspace
 * enables E2E. The passphrase is collected via the themed `usePrompt` (no
 * native dialogs) and never leaves the browser.
 */
type Status =
  | { kind: 'loading' }
  | { kind: 'enrolled' }
  | { kind: 'needs-recovery' }
  | { kind: 'unenrolled' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function E2EEnrollCard({ enabled = true }: { enabled?: boolean }) {
  const t = useT();
  const prompt = usePrompt();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void ensureEnrolled().then((r) => {
      if (cancelled) return;
      if (r.enrolled) setStatus({ kind: 'enrolled' });
      else if (r.reason === 'local-blob-missing') setStatus({ kind: 'needs-recovery' });
      else setStatus({ kind: 'unenrolled' });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  async function run() {
    setBusy(true);
    try {
      const pass = await prompt({
        title: t('e2e.enroll.passphrasePrompt'),
        type: 'password',
        confirmLabel: t('e2e.enroll.cta'),
      });
      if (!pass) return;
      const confirm = await prompt({
        title: t('e2e.enroll.confirmPrompt'),
        type: 'password',
        confirmLabel: t('e2e.enroll.cta'),
      });
      if (pass !== confirm) {
        setStatus({ kind: 'error', message: t('e2e.enroll.mismatch') });
        return;
      }
      await enrollKeypair(pass);
      setStatus({ kind: 'done' });
    } catch (e) {
      setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-semibold text-lg">{t('e2e.enroll.title')}</h2>
        <EncryptionDisabledNotice />
      </section>
    );
  }

  if (status.kind === 'loading') return null;

  return (
    <section className="space-y-2 rounded-lg border p-4">
      <h2 className="font-semibold text-lg">{t('e2e.enroll.title')}</h2>
      <p className="text-muted-foreground text-sm">{t('e2e.enroll.description')}</p>
      {status.kind === 'enrolled' || status.kind === 'done' ? (
        <p className="font-medium text-sm">
          {status.kind === 'done' ? t('e2e.enroll.success') : t('e2e.enroll.alreadyEnrolled')}
        </p>
      ) : status.kind === 'needs-recovery' ? (
        <p className="text-destructive text-sm">{t('e2e.enroll.recoveryNeeded')}</p>
      ) : (
        <>
          <Button type="button" onClick={run} disabled={busy}>
            {busy ? t('e2e.enroll.busy') : t('e2e.enroll.cta')}
          </Button>
          <p className="text-muted-foreground text-xs">{t('e2e.enroll.warning')}</p>
        </>
      )}
      {status.kind === 'error' ? (
        <p className="text-destructive text-sm">{status.message}</p>
      ) : null}
    </section>
  );
}
