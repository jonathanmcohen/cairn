'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { BackupBundle } from '@/lib/backups/list';
import { useT } from '@/lib/i18n/provider';

// Client view for the backup snapshot settings page. The parent RSC fetches
// the bundle list and gates on requireRole('admin'); this renders the i18n
// copy (RSCs cannot call the useT() hook), the bundle table, and the
// create-now button: POST /api/admin/backups → poll the returned job id every
// ~2s → router.refresh() so the RSC re-reads the directory.
export function BackupsView({ bundles }: { bundles: BackupBundle[] }) {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Cancels the poll loop when the component unmounts mid-job.
  const cancelledRef = useRef(false);
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

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

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold">{t('settingsAdmin.backups.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('settingsAdmin.backups.description')}
        </p>
      </header>

      <section className="space-y-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void createSnapshot()}
            disabled={phase === 'running'}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            data-testid="backup-create-now"
          >
            {phase === 'running'
              ? t('settingsAdmin.backups.creating')
              : t('settingsAdmin.backups.createNow')}
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
        </div>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
