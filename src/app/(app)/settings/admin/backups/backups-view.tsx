'use client';

import { useRouter } from 'next/navigation';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { BackupBundle } from '@/lib/backups/list';
import { useT } from '@/lib/i18n/provider';
import { type AdminWorkspaceOption, SelectiveRestoreDialog } from './selective-restore-dialog';

// Client view for the backup snapshot settings page. The parent RSC fetches
// the bundle list and gates on requireRole('admin'); this renders the i18n
// copy (RSCs cannot call the useT() hook), the bundle table, and three flows:
//   - create-now (C1): POST /api/admin/backups → poll the job → refresh;
//   - upload (C2): multipart POST /api/admin/backups/upload → refresh;
//   - restore (C2): per-bundle confirm modal (retype the database name) →
//     POST /api/admin/backups/restore → poll the job → refresh.
//
// SCOPING (v0.10.0 C2): the "restore in progress — read-only" banner lives on
// THIS page only, not the (app) layout. A global banner would need every user
// to poll the maintenance flag continuously; instead, any user who attempts a
// write during a restore gets the proxy's 503 maintenance answer through the
// existing per-surface error handling, and the admin driving the restore
// watches it here. On mount the view asks GET /api/admin/backups/restore once
// so a reload mid-restore re-attaches to the banner (no idle polling: it only
// keeps polling while maintenance is actually active).
// v0.10.0 C4 — `adminWorkspaces` (the caller's admin/owner workspaces,
// resolved by the parent RSC) feeds the per-bundle "Selective restore…"
// dialog's target-workspace picker.
export function BackupsView({
  bundles,
  adminWorkspaces,
}: {
  bundles: BackupBundle[];
  adminWorkspaces: AdminWorkspaceOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'done' | 'failed'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupBundle | null>(null);
  // v0.10.0 C4 — bundle slug the selective-restore dialog is open for.
  const [selectiveTs, setSelectiveTs] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [restorePhase, setRestorePhase] = useState<
    'idle' | 'starting' | 'running' | 'done' | 'failed'
  >('idle');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Cancels the poll loops when the component unmounts mid-job.
  const cancelledRef = useRef(false);
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const restoreBusy = restorePhase === 'starting' || restorePhase === 'running';

  // Re-attach to an in-flight restore after a reload: one status fetch on
  // mount; keeps polling ONLY while maintenance is active (no idle polling).
  // Without a job id the outcome is unknown, so when the flag clears we just
  // refresh the list and return to idle.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/backups/restore');
        if (!res.ok) return;
        const { maintenance } = (await res.json()) as { maintenance: { active: boolean } };
        if (!maintenance.active || cancelled) return;
        setRestorePhase('running');
        while (!cancelled) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          try {
            const poll = await fetch('/api/admin/backups/restore');
            if (!poll.ok) continue;
            const body = (await poll.json()) as { maintenance: { active: boolean } };
            if (!body.maintenance.active) {
              setRestorePhase('idle');
              router.refresh();
              return;
            }
          } catch {
            // transient (the DB is being clobbered mid-restore) — keep polling
          }
        }
      } catch {
        // status probe failed — leave the view in its default idle state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function pollJob(jobId: string): Promise<void> {
    while (!cancelledRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const res = await fetch(`/api/admin/backups/jobs/${jobId}`);
      if (!res.ok) {
        setPhase('failed');
        setError(null);
        return;
      }
      const job = (await res.json()) as { status: string; error?: string };
      if (job.status === 'done') {
        setPhase('done');
        router.refresh();
        return;
      }
      if (job.status === 'failed') {
        setPhase('failed');
        setError(job.error ?? null);
        return;
      }
    }
  }

  async function createSnapshot(): Promise<void> {
    setPhase('running');
    setError(null);
    try {
      const res = await fetch('/api/admin/backups', { method: 'POST' });
      if (res.status === 503) {
        setPhase('failed');
        setError(t('settingsAdmin.backups.pgDumpMissing'));
        return;
      }
      if (res.status !== 202) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setPhase('failed');
        setError(body?.error ?? null);
        return;
      }
      const { jobId } = (await res.json()) as { jobId: string };
      await pollJob(jobId);
    } catch {
      setPhase('failed');
      setError(null);
    }
  }

  async function uploadBundle(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after a failure
    if (!file) return;
    setUploadPhase('uploading');
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/admin/backups/upload', { method: 'POST', body: form });
      if (res.status === 201) {
        setUploadPhase('done');
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setUploadPhase('failed');
      if (res.status === 400) setUploadError(t('settingsAdmin.backups.upload.invalid'));
      else if (res.status === 413) setUploadError(t('settingsAdmin.backups.upload.tooLarge'));
      else setUploadError(body?.error ?? null);
    } catch {
      setUploadPhase('failed');
      setUploadError(null);
    }
  }

  /** Map a restore-start failure to friendly copy; non-leaky by design. */
  function restoreStartErrorMessage(status: number, code: string | null): string {
    if (status === 400 && code === 'confirmation-mismatch') {
      return t('settingsAdmin.backups.restore.mismatch');
    }
    if (status === 400 && code?.includes('CAIRN_BACKUP_ENCRYPTION_PASSPHRASE')) {
      return t('settingsAdmin.backups.restore.encPassphraseMissing');
    }
    if (status === 404) return t('settingsAdmin.backups.restore.notFound');
    if (status === 409) return t('settingsAdmin.backups.restore.conflict');
    return code ?? t('settingsAdmin.backups.restore.startFailed');
  }

  async function pollRestoreJob(jobId: string): Promise<void> {
    while (!cancelledRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      try {
        const res = await fetch(`/api/admin/backups/jobs/${jobId}`);
        // Transient non-200s are expected mid-restore (the status route's auth
        // queries hit tables pg_restore is rebuilding) — keep polling.
        if (!res.ok) continue;
        const job = (await res.json()) as { status: string; error?: string };
        if (job.status === 'done') {
          setRestorePhase('done');
          router.refresh();
          return;
        }
        if (job.status === 'failed') {
          setRestorePhase('failed');
          setRestoreError(job.error ?? null);
          router.refresh();
          return;
        }
      } catch {
        // transient network failure — keep polling
      }
    }
  }

  async function startRestore(): Promise<void> {
    if (!restoreTarget) return;
    setRestorePhase('starting');
    setRestoreError(null);
    try {
      const res = await fetch('/api/admin/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ts: restoreTarget.ts, confirmDatabase: confirmText.trim() }),
      });
      if (res.status !== 202) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setRestorePhase('idle'); // keep the modal open with the inline error
        setRestoreError(restoreStartErrorMessage(res.status, body?.error ?? null));
        return;
      }
      const { jobId } = (await res.json()) as { jobId: string };
      setRestoreTarget(null);
      setConfirmText('');
      setRestorePhase('running');
      await pollRestoreJob(jobId);
    } catch {
      setRestorePhase('idle');
      setRestoreError(t('settingsAdmin.backups.restore.startFailed'));
    }
  }

  function openRestoreModal(bundle: BackupBundle): void {
    setRestoreTarget(bundle);
    setConfirmText('');
    setRestoreError(null);
  }

  function closeRestoreModal(): void {
    setRestoreTarget(null);
    setConfirmText('');
    setRestoreError(null);
  }

  return (
    <>
      {restorePhase === 'running' ? (
        <div
          role="status"
          data-testid="restore-banner"
          className="w-full rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm font-medium"
        >
          {t('settingsAdmin.backups.restore.banner')}
        </div>
      ) : null}

      <header>
        <h1 className="text-xl font-semibold">{t('settingsAdmin.backups.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('settingsAdmin.backups.description')}
        </p>
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => void createSnapshot()}
            disabled={phase === 'running' || restoreBusy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            data-testid="backup-create-now"
          >
            {phase === 'running'
              ? t('settingsAdmin.backups.creating')
              : t('settingsAdmin.backups.createNow')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".dump,.enc"
            className="hidden"
            onChange={(e) => void uploadBundle(e)}
            data-testid="backup-upload-input"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadPhase === 'uploading' || restoreBusy}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            data-testid="backup-upload-button"
          >
            {uploadPhase === 'uploading'
              ? t('settingsAdmin.backups.upload.uploading')
              : t('settingsAdmin.backups.upload.button')}
          </button>
          {phase === 'done' ? (
            <p role="status" className="text-sm text-success" data-testid="backup-success">
              {t('settingsAdmin.backups.success')}
            </p>
          ) : null}
          {phase === 'failed' ? (
            <p role="alert" className="text-sm text-destructive" data-testid="backup-error">
              {t('settingsAdmin.backups.failed', { error: error ?? '' })}
            </p>
          ) : null}
          {uploadPhase === 'done' ? (
            <p role="status" className="text-sm text-success" data-testid="upload-success">
              {t('settingsAdmin.backups.upload.success')}
            </p>
          ) : null}
          {uploadPhase === 'failed' ? (
            <p role="alert" className="text-sm text-destructive" data-testid="upload-error">
              {t('settingsAdmin.backups.upload.failed', { error: uploadError ?? '' })}
            </p>
          ) : null}
        </div>
        {restorePhase === 'done' ? (
          <p role="status" className="text-sm text-success" data-testid="restore-success">
            {t('settingsAdmin.backups.restore.success')}
          </p>
        ) : null}
        {restorePhase === 'failed' ? (
          <p role="alert" className="text-sm text-destructive" data-testid="restore-error">
            {t('settingsAdmin.backups.restore.failed', { error: restoreError ?? '' })}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="backup-bundles" className="space-y-4">
        <h2 id="backup-bundles" className="text-lg font-medium">
          {t('settingsAdmin.backups.bundles')}
        </h2>
        {bundles.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="backups-empty">
            {t('settingsAdmin.backups.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('settingsAdmin.backups.col.bundle')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('settingsAdmin.backups.col.createdAt')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('settingsAdmin.backups.col.version')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('settingsAdmin.backups.col.encryption')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('settingsAdmin.backups.col.dumpSize')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('settingsAdmin.backups.col.uploadsSize')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('settingsAdmin.backups.col.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b) => (
                  <tr key={b.ts} className="border-b last:border-b-0" data-testid="backup-row">
                    <td className="px-4 py-2 font-mono text-xs">{b.ts}</td>
                    <td className="px-4 py-2">{new Date(b.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2">{b.version}</td>
                    <td className="px-4 py-2">
                      {b.encrypted ? (
                        <span className="rounded bg-success/15 px-2 py-1 text-xs text-success">
                          {t('settingsAdmin.backups.encrypted')}
                        </span>
                      ) : (
                        <span className="rounded bg-muted px-2 py-1 text-xs">
                          {t('settingsAdmin.backups.unencrypted')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">{formatBytes(b.dumpBytes)}</td>
                    <td className="px-4 py-2">
                      {b.uploadsBytes === null ? '—' : formatBytes(b.uploadsBytes)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openRestoreModal(b)}
                          disabled={restoreBusy}
                          className="rounded-md border border-destructive/50 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          data-testid="backup-restore-button"
                        >
                          {t('settingsAdmin.backups.restore.button')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectiveTs(b.ts)}
                          disabled={restoreBusy}
                          className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                          data-testid="backup-selective-restore-button"
                        >
                          {t('settingsAdmin.backups.selective.button')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SelectiveRestoreDialog
        bundleTs={selectiveTs}
        workspaces={adminWorkspaces}
        onClose={() => setSelectiveTs(null)}
      />

      <Dialog open={restoreTarget !== null} onOpenChange={(open) => !open && closeRestoreModal()}>
        <DialogContent data-testid="restore-confirm-modal">
          <DialogHeader>
            <DialogTitle>{t('settingsAdmin.backups.restore.title')}</DialogTitle>
            <DialogDescription>{t('settingsAdmin.backups.restore.warning')}</DialogDescription>
          </DialogHeader>
          {restoreTarget ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="font-medium">{t('settingsAdmin.backups.col.bundle')}</dt>
              <dd className="font-mono text-xs leading-5">{restoreTarget.ts}</dd>
              <dt className="font-medium">{t('settingsAdmin.backups.col.createdAt')}</dt>
              <dd>{new Date(restoreTarget.createdAt).toLocaleString()}</dd>
              <dt className="font-medium">{t('settingsAdmin.backups.col.version')}</dt>
              <dd>{restoreTarget.version}</dd>
              <dt className="font-medium">{t('settingsAdmin.backups.restore.database')}</dt>
              <dd>{restoreTarget.database}</dd>
              <dt className="font-medium">{t('settingsAdmin.backups.col.encryption')}</dt>
              <dd>
                {restoreTarget.encrypted
                  ? t('settingsAdmin.backups.encrypted')
                  : t('settingsAdmin.backups.unencrypted')}
              </dd>
            </dl>
          ) : null}
          <label className="block space-y-2 text-sm">
            <span className="font-medium">{t('settingsAdmin.backups.restore.confirmLabel')}</span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              data-testid="restore-confirm-input"
            />
          </label>
          {restoreError ? (
            <p role="alert" className="text-sm text-destructive" data-testid="restore-modal-error">
              {restoreError}
            </p>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={closeRestoreModal}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              {t('settingsAdmin.backups.restore.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void startRestore()}
              disabled={confirmText.trim() === '' || restorePhase === 'starting'}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              data-testid="restore-confirm-button"
            >
              {t('settingsAdmin.backups.restore.confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(1)} ${unit}`;
}
