'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';
import type { RebuildJob } from '@/lib/search/rebuild-index';

/**
 * v0.10.0 D8 — "Rebuild semantic index" card on the admin health page.
 *
 * POST /api/admin/search/reindex starts the two-phase job (embedding-data
 * refresh, then REINDEX INDEX CONCURRENTLY on the HNSW index); while the job
 * is running the card polls GET every ~2s and the button stays disabled (the
 * route's debounce — 200 with the existing job — is surfaced in the UI too).
 * The card doubles as the last-run record: state badge, timestamps, the
 * vectors-pass summary (errors included — per-page embed failures don't fail
 * the run), and the error message when the run itself failed.
 */

const POLL_INTERVAL_MS = 2_000;

async function fetchJob(): Promise<RebuildJob | null> {
  const res = await fetch('/api/admin/search/reindex');
  if (!res.ok) return null;
  const body = (await res.json()) as { job: RebuildJob | null };
  return body.job;
}

export function ReindexCard() {
  const t = useT();
  const [job, setJob] = useState<RebuildJob | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // Initial load: show the last run (the registry doubles as last-run state).
  useEffect(() => {
    let cancelled = false;
    void fetchJob()
      .then((j) => {
        if (!cancelled && j) setJob(j);
      })
      .catch(() => {
        /* never-run / transient — the card just shows "never run" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll while running; the interval clears on unmount and when the job
  // leaves 'running' (this effect re-runs and bails).
  const running = job?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void fetchJob()
        .then((j) => {
          if (j) setJob(j);
        })
        .catch(() => {
          /* transient poll failure — keep polling */
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running]);

  async function startRebuild(): Promise<void> {
    setIsStarting(true);
    setStartFailed(false);
    try {
      const res = await fetch('/api/admin/search/reindex', { method: 'POST' });
      if (!res.ok) {
        setStartFailed(true);
        return;
      }
      // 202 = started; 200 = a rebuild was already running — either way the
      // body carries the job to track.
      const body = (await res.json()) as { job: RebuildJob };
      setJob(body.job);
    } catch {
      setStartFailed(true);
    } finally {
      setIsStarting(false);
    }
  }

  const stateLabel =
    job === null
      ? null
      : job.state === 'running'
        ? t('admin.health.reindex.stateRunning')
        : job.state === 'done'
          ? t('admin.health.reindex.stateDone')
          : t('admin.health.reindex.stateError');

  return (
    <section data-testid="reindex-card" className="rounded border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{t('admin.health.reindex.title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('admin.health.reindex.description')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0"
          data-testid="reindex-rebuild"
          disabled={running || isStarting}
          onClick={() => void startRebuild()}
        >
          {t('admin.health.reindex.button')}
        </Button>
      </div>

      {startFailed ? (
        <p role="alert" className="mt-3 text-xs font-medium text-destructive">
          {t('admin.health.reindex.startError')}
        </p>
      ) : null}

      {job === null ? (
        <p data-testid="reindex-never-run" className="mt-3 text-xs text-muted-foreground">
          {t('admin.health.reindex.neverRun')}
        </p>
      ) : (
        <div className="mt-3 space-y-2" data-testid="reindex-last-run">
          <div className="flex flex-wrap items-center gap-3">
            <span
              data-testid="reindex-state-badge"
              data-state={job.state}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                job.state === 'error'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : job.state === 'running'
                    ? 'border-warning/40 bg-warning/10 text-warning'
                    : 'border bg-muted text-muted-foreground'
              }`}
            >
              {stateLabel}
            </span>
            {job.state === 'running' ? (
              <span className="text-xs text-muted-foreground" data-testid="reindex-phase">
                {job.phase === 'index'
                  ? t('admin.health.reindex.phaseIndex')
                  : t('admin.health.reindex.phaseVectors')}
              </span>
            ) : null}
          </div>

          <dl className="space-y-1 text-xs text-muted-foreground">
            <div className="flex items-baseline gap-2">
              <dt className="font-medium">{t('admin.health.reindex.startedAtLabel')}</dt>
              {/* suppressHydrationWarning: toLocaleString legitimately differs
                  between the server render and the browser. */}
              <dd suppressHydrationWarning>{new Date(job.startedAt).toLocaleString()}</dd>
            </div>
            {job.finishedAt ? (
              <div className="flex items-baseline gap-2">
                <dt className="font-medium">{t('admin.health.reindex.finishedAtLabel')}</dt>
                <dd suppressHydrationWarning>{new Date(job.finishedAt).toLocaleString()}</dd>
              </div>
            ) : null}
          </dl>

          {job.vectors ? (
            <p data-testid="reindex-vectors-summary" className="text-xs text-muted-foreground">
              {t('admin.health.reindex.vectorsSummary', {
                processed: job.vectors.processed,
                embedded: job.vectors.embedded,
                skipped: job.vectors.skipped,
                errors: job.vectors.errors,
              })}
            </p>
          ) : null}

          {job.state === 'error' && job.error ? (
            <p
              data-testid="reindex-error"
              role="alert"
              className="break-words font-mono text-xs text-destructive"
            >
              {job.error}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
