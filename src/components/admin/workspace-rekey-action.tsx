'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { usePrompt } from '@/components/ui/input-dialog';
import { ensureEnrolled } from '@/lib/e2e/enroll-client';
import { runRekey } from '@/lib/e2e/rekey-client';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.9.7 G21 (#168) — owner-facing workspace rekey / member-removal UI.
 *
 * Lists current members (with enrollment status), lets the owner remove a
 * member (mint a fresh WSK, re-wrap for the remaining roster, re-encrypt every
 * page — forward secrecy) or rotate the key without removing anyone. All
 * crypto runs client-side via `runRekey`; the destructive action is gated by
 * the themed `useConfirm` (no native dialogs) and a passphrase prompt.
 */
type Member = { userId: string; name: string; email: string; hasKeypair: boolean };

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; version: number }
  | { kind: 'error'; message: string };

export function WorkspaceRekeyAction({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/e2e/members`);
        if (!res.ok) throw new Error('load failed');
        const rows = (await res.json()) as Member[];
        if (!cancelled) setMembers(rows);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function rekey(removedMemberId: string | null) {
    const ok = await confirm({
      title: t('e2e.rekey.confirmTitle'),
      description: t('e2e.rekey.confirmBody'),
      confirmLabel: t('e2e.rekey.cta'),
      variant: 'danger',
    });
    if (!ok) return;

    const enrolled = await ensureEnrolled();
    if (!enrolled.enrolled) {
      setStatus({ kind: 'error', message: t('e2e.enroll.recoveryNeeded') });
      return;
    }
    const passphrase = await prompt({
      title: t('e2e.enroll.passphrasePrompt'),
      type: 'password',
      confirmLabel: t('e2e.rekey.cta'),
    });
    if (!passphrase) return;

    setBusy(true);
    setStatus({ kind: 'running', done: 0, total: 0 });
    try {
      const result = await runRekey({
        workspaceId,
        passphrase,
        sealed: enrolled.stored,
        removedMemberId,
        onProgress: (done, total) => setStatus({ kind: 'running', done, total }),
      });
      setStatus({ kind: 'done', version: result.keyVersion });
    } catch (e) {
      setStatus({
        kind: 'error',
        message: t('e2e.rekey.error', { message: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return <p className="text-destructive text-sm">{t('e2e.rekey.loadFailed')}</p>;
  }
  if (!members) return null;

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold text-lg">{t('e2e.rekey.title')}</h2>
      <p className="text-muted-foreground text-sm">{t('e2e.rekey.description')}</p>
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2">
            <span className="text-sm">
              <span className="font-medium">{m.name}</span>{' '}
              <span className="text-muted-foreground">{m.email}</span>
            </span>
            {m.hasKeypair ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => rekey(m.userId)}
              >
                {t('e2e.rekey.removeMember')}
              </Button>
            ) : (
              <span className="text-destructive text-xs">{t('e2e.rekey.noKeypairWarning')}</span>
            )}
          </li>
        ))}
      </ul>
      <Button type="button" disabled={busy} onClick={() => rekey(null)}>
        {busy ? t('e2e.rekey.busy') : t('e2e.rekey.rotateOnly')}
      </Button>
      {status.kind === 'running' ? (
        <p className="text-sm">
          {t('e2e.rekey.progress', { done: status.done, total: status.total })}
        </p>
      ) : null}
      {status.kind === 'done' ? (
        <p className="font-medium text-sm">{t('e2e.rekey.success', { version: status.version })}</p>
      ) : null}
      {status.kind === 'error' ? (
        <p className="text-destructive text-sm">{status.message}</p>
      ) : null}
    </section>
  );
}
