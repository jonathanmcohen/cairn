'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

// v0.10.0 C4 — per-bundle "Selective restore…" dialog. Deliberately
// HONEST-MINIMAL on the source side: the operator pastes the source page /
// workspace uuid from the instance the snapshot was taken on (a
// browse-the-snapshot picker would require restoring the bundle just to
// render the form). Target side is a real picker over the caller's
// admin/owner workspaces (resolved server-side by the page RSC).
//
// a11y notes carried over from C3: the ui Select primitive (never a raw
// <select>), and the Radix triggers live in a <div> with aria-label on the
// SelectTrigger — never wrapped in a <label> (noLabelWithoutControl is
// error-severity).

export type AdminWorkspaceOption = { id: string; name: string };

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'failed';

type JobResult = { pagesRestored: number; rowsRestored: number; skippedFiles: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SelectiveRestoreDialog({
  bundleTs,
  workspaces,
  onClose,
}: {
  /** Bundle slug to restore from; null = dialog closed. */
  bundleTs: string | null;
  workspaces: AdminWorkspaceOption[];
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<'page' | 'workspace'>('page');
  const [sourceId, setSourceId] = useState('');
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const cancelledRef = useRef(false);
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Reset the form whenever the dialog opens for a (new) bundle.
  useEffect(() => {
    if (bundleTs !== null) {
      setMode('page');
      setSourceId('');
      setConfirmed(false);
      setPhase('idle');
      setError(null);
      setResult(null);
    }
  }, [bundleTs]);

  const busy = phase === 'starting' || phase === 'running';
  const sourceValid = UUID_RE.test(sourceId.trim());
  const canStart = sourceValid && confirmed && targetWorkspaceId !== '' && !busy;

  async function pollJob(jobId: string): Promise<void> {
    while (!cancelledRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      try {
        const res = await fetch(`/api/admin/backups/jobs/${jobId}`);
        if (!res.ok) continue;
        const job = (await res.json()) as { status: string; error?: string; result?: JobResult };
        if (job.status === 'done') {
          setPhase('done');
          setResult(job.result ?? null);
          router.refresh();
          return;
        }
        if (job.status === 'failed') {
          setPhase('failed');
          setError(job.error ?? null);
          return;
        }
      } catch {
        // transient network failure — keep polling
      }
    }
  }

  async function start(): Promise<void> {
    if (!bundleTs || !canStart) return;
    setPhase('starting');
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/backups/selective-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: bundleTs,
          mode,
          ...(mode === 'page'
            ? { sourcePageId: sourceId.trim() }
            : { sourceWorkspaceId: sourceId.trim() }),
          targetWorkspaceId,
          confirm: true,
        }),
      });
      if (res.status !== 202) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setPhase('failed');
        setError(body?.error ?? t('settingsAdmin.backups.selective.startFailed'));
        return;
      }
      const { jobId } = (await res.json()) as { jobId: string };
      setPhase('running');
      await pollJob(jobId);
    } catch {
      setPhase('failed');
      setError(t('settingsAdmin.backups.selective.startFailed'));
    }
  }

  return (
    <Dialog open={bundleTs !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="selective-restore-modal">
        <DialogHeader>
          <DialogTitle>{t('settingsAdmin.backups.selective.title')}</DialogTitle>
          <DialogDescription>{t('settingsAdmin.backups.selective.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="space-y-2">
            <span className="font-medium">{t('settingsAdmin.backups.selective.mode')}</span>
            <Select
              value={mode}
              onValueChange={(next) => setMode(next as 'page' | 'workspace')}
              disabled={busy}
            >
              <SelectTrigger
                aria-label={t('settingsAdmin.backups.selective.mode')}
                className="w-full"
                data-testid="selective-restore-mode"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="page">
                  {t('settingsAdmin.backups.selective.modePage')}
                </SelectItem>
                <SelectItem value="workspace">
                  {t('settingsAdmin.backups.selective.modeWorkspace')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label className="block space-y-2">
            <span className="font-medium">
              {mode === 'page'
                ? t('settingsAdmin.backups.selective.sourcePage')
                : t('settingsAdmin.backups.selective.sourceWorkspace')}
            </span>
            <input
              type="text"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              data-testid="selective-restore-source"
            />
            <span className="block text-xs text-muted-foreground">
              {t('settingsAdmin.backups.selective.sourceHelp')}
            </span>
            {sourceId.trim() !== '' && !sourceValid ? (
              <span className="block text-xs text-destructive">
                {t('settingsAdmin.backups.selective.invalidUuid')}
              </span>
            ) : null}
          </label>

          <div className="space-y-2">
            <span className="font-medium">{t('settingsAdmin.backups.selective.target')}</span>
            <Select value={targetWorkspaceId} onValueChange={setTargetWorkspaceId} disabled={busy}>
              <SelectTrigger
                aria-label={t('settingsAdmin.backups.selective.target')}
                className="w-full"
                data-testid="selective-restore-target"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy}
              data-testid="selective-restore-confirm"
            />
            <span>{t('settingsAdmin.backups.selective.confirm')}</span>
          </label>
        </div>

        {phase === 'running' ? (
          <p role="status" className="text-sm" data-testid="selective-restore-running">
            {t('settingsAdmin.backups.selective.running')}
          </p>
        ) : null}
        {phase === 'done' ? (
          <p role="status" className="text-sm text-success" data-testid="selective-restore-success">
            {t('settingsAdmin.backups.selective.success', {
              pages: String(result?.pagesRestored ?? 0),
              rows: String(result?.rowsRestored ?? 0),
              skipped: String(result?.skippedFiles ?? 0),
            })}
          </p>
        ) : null}
        {phase === 'failed' ? (
          <p
            role="alert"
            className="text-sm text-destructive"
            data-testid="selective-restore-error"
          >
            {t('settingsAdmin.backups.selective.failed', { error: error ?? '' })}
          </p>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            {phase === 'done'
              ? t('settingsAdmin.backups.selective.close')
              : t('settingsAdmin.backups.restore.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canStart}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            data-testid="selective-restore-start"
          >
            {phase === 'starting'
              ? t('settingsAdmin.backups.selective.starting')
              : t('settingsAdmin.backups.selective.start')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
