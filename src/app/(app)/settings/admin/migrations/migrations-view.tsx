'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { OPERATIONS_DOCS_URL } from '@/lib/docs-links';
import { useT } from '@/lib/i18n/provider';
import type { MigrationStatus } from '@/lib/upgrade/status';

/**
 * v0.10.0 D7 — read-only migration status panel view. Pure presentation over
 * the server-assembled MigrationStatus (src/lib/upgrade/status.ts); Refresh
 * re-runs the RSC via router.refresh(), same pattern as the sibling health
 * panel.
 *
 * The three states are visually AND semantically distinct (the spec asserts
 * this): the summary badge carries data-state="ok" | "pending" | "drift", the
 * pending block is a separate amber data-state="pending" region (role=status)
 * and the drift block a separate red data-state="drift" region (role=alert).
 *
 * Recovery is COPY, not a button — the v0.9.17 postmortem rejected in-process
 * retry (duplicate-ALTER trap):
 *   pending → restart the container (migrations apply at boot; the server
 *             refuses to start half-migrated)
 *   drift   → roll the image forward or restore a pre-mismatch backup; never
 *             re-run a half-applied migration by hand
 */

/** Show the newest N applied rows; the rest sit behind a show-all toggle. */
const COLLAPSED_APPLIED_COUNT = 5;

const BLOCK_BASE = 'rounded border p-4';
const BLOCK_WARNING = 'border-warning/40 bg-warning/10';
const BLOCK_DESTRUCTIVE = 'border-destructive/40 bg-destructive/10';

export function MigrationsView({ status }: { status: MigrationStatus | null }) {
  const t = useT();
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [showAllApplied, setShowAllApplied] = useState(false);

  const state: 'ok' | 'pending' | 'drift' =
    status === null
      ? 'ok'
      : status.drifted
        ? 'drift'
        : status.pending.length > 0
          ? 'pending'
          : 'ok';

  // Newest first — an ops panel cares about the most recent migration.
  const appliedNewestFirst = status ? [...status.applied].reverse() : [];
  const collapsible = appliedNewestFirst.length > COLLAPSED_APPLIED_COUNT;
  const visibleApplied =
    collapsible && !showAllApplied
      ? appliedNewestFirst.slice(0, COLLAPSED_APPLIED_COUNT)
      : appliedNewestFirst;

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('admin.migrations.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.migrations.description')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0"
          data-testid="migrations-refresh"
          disabled={isRefreshing}
          onClick={() => startTransition(() => router.refresh())}
        >
          {t('admin.migrations.refresh')}
        </Button>
      </header>

      {status === null ? (
        // Journal missing on this deployment — degraded, not a crash. The API
        // route answers 503 for the same condition.
        <section
          data-testid="migrations-journal-missing"
          role="alert"
          className={`${BLOCK_BASE} ${BLOCK_DESTRUCTIVE}`}
        >
          <p className="text-sm font-medium text-destructive">
            {t('admin.migrations.journalMissing')}
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          <section
            data-testid="migrations-summary"
            className={`${BLOCK_BASE} flex flex-wrap items-center justify-between gap-3 bg-card`}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('admin.migrations.currentVersionLabel')}</p>
              <p
                className="mt-1 font-mono text-sm text-muted-foreground"
                data-testid="migrations-current-version"
              >
                {status.currentVersion ?? t('admin.migrations.currentVersionNone')}
              </p>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-testid="migrations-applied-count"
              >
                {t('admin.migrations.appliedOfTotal', {
                  applied: status.appliedCount,
                  total: status.journalCount,
                })}
              </p>
            </div>
            <span
              data-testid="migrations-state-badge"
              data-state={state}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                state === 'drift'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : state === 'pending'
                    ? 'border-warning/40 bg-warning/10 text-warning'
                    : 'border bg-muted text-muted-foreground'
              }`}
            >
              {state === 'drift'
                ? t('admin.migrations.stateDrift')
                : state === 'pending'
                  ? t('admin.migrations.statePending', { count: status.pending.length })
                  : t('admin.migrations.stateOk')}
            </span>
          </section>

          {status.drifted ? (
            // Drift: the DB is AHEAD of this image's journal — semantically
            // distinct from pending (red + role=alert vs amber + role=status).
            <section
              data-testid="migrations-drift"
              data-state="drift"
              role="alert"
              className={`${BLOCK_BASE} ${BLOCK_DESTRUCTIVE}`}
            >
              <h2 className="text-sm font-semibold text-destructive">
                {t('admin.migrations.driftHeading')}
              </h2>
              {status.driftReason ? (
                <p className="mt-1 font-mono text-xs text-destructive">{status.driftReason}</p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {t('admin.migrations.driftRecovery')}
              </p>
            </section>
          ) : null}

          {status.pending.length > 0 ? (
            <section
              data-testid="migrations-pending"
              data-state="pending"
              role="status"
              className={`${BLOCK_BASE} ${BLOCK_WARNING}`}
            >
              <h2 className="text-sm font-semibold">{t('admin.migrations.pendingHeading')}</h2>
              <ul className="mt-2 space-y-1">
                {status.pending.map((entry) => (
                  <li
                    key={entry.idx}
                    className="font-mono text-xs"
                    data-testid="migrations-pending-row"
                  >
                    {entry.tag}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('admin.migrations.pendingRecovery')}
              </p>
            </section>
          ) : null}

          <section data-testid="migrations-applied" className={`${BLOCK_BASE} bg-card`}>
            <h2 className="text-sm font-medium">{t('admin.migrations.appliedHeading')}</h2>
            {visibleApplied.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('admin.migrations.appliedEmpty')}
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {visibleApplied.map((entry) => (
                  <li
                    key={entry.idx}
                    className="flex items-baseline justify-between gap-3"
                    data-testid="migrations-applied-row"
                  >
                    <span className="min-w-0 truncate font-mono text-xs">{entry.tag}</span>
                    {entry.appliedAt ? (
                      // suppressHydrationWarning: toLocaleString legitimately
                      // differs between the server render and the browser.
                      <time
                        dateTime={entry.appliedAt}
                        suppressHydrationWarning
                        className="shrink-0 text-xs text-muted-foreground"
                      >
                        {new Date(entry.appliedAt).toLocaleString()}
                      </time>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('admin.migrations.appliedAtUnknown')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {collapsible ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 min-h-11"
                data-testid="migrations-show-all"
                aria-expanded={showAllApplied}
                onClick={() => setShowAllApplied((v) => !v)}
              >
                {showAllApplied
                  ? t('admin.migrations.showRecent')
                  : t('admin.migrations.showAll', { count: appliedNewestFirst.length })}
              </Button>
            ) : null}
          </section>
        </div>
      )}

      <p data-testid="migrations-recovery-note" className="mt-4 text-xs text-muted-foreground">
        {t('admin.migrations.readOnlyNote')}{' '}
        <a
          href={OPERATIONS_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
          data-testid="migrations-docs-link"
        >
          {t('admin.migrations.docsLink')}
        </a>
      </p>
    </div>
  );
}
