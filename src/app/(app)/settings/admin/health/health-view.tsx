'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { CollabBridgeState, HealthSnapshot } from '@/lib/health/panel';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.10.0 D4 — admin health panel view. Pure presentation over the
 * server-aggregated snapshot (src/lib/health/panel.ts); Refresh re-runs the
 * RSC probes via router.refresh() so no client polling loop is needed.
 *
 * Degraded states render distinctly (spec asserts a degraded render):
 *   - db down            → destructive row (the instance is actually broken)
 *   - collab unreachable → warning row (configured but the process is down)
 *   - collab unconfigured→ warning row (the A4 silent-OFF misconfiguration)
 * Uptime is labeled per-replica: behind a load balancer each replica has its
 * own process.uptime() and this page only sees the replica that answered.
 */

/** 3725 → "1h 2m 5s". Pure numeric+unit text, composed outside the catalog. */
function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

const ROW_BASE = 'flex items-start justify-between gap-3 rounded border p-3';
const ROW_OK = 'bg-card';
const ROW_DESTRUCTIVE = 'border-destructive/40 bg-destructive/10';
const ROW_WARNING = 'border-warning/40 bg-warning/10';

function collabRowClass(state: CollabBridgeState): string {
  return state === 'connected' ? ROW_OK : ROW_WARNING;
}

export function HealthView({ snapshot }: { snapshot: HealthSnapshot }) {
  const t = useT();
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  const dbDown = snapshot.db === 'down';

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('admin.health.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.health.description')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0"
          data-testid="health-refresh"
          disabled={isRefreshing}
          onClick={() => startTransition(() => router.refresh())}
        >
          {t('admin.health.refresh')}
        </Button>
      </header>

      <ul className="space-y-2">
        <li
          data-testid="health-db"
          data-state={snapshot.db}
          // db down = the instance is genuinely broken → destructive, not the
          // softer warning tint the optional collab bridge uses below.
          className={`${ROW_BASE} ${dbDown ? ROW_DESTRUCTIVE : ROW_OK}`}
        >
          <span className="text-sm font-medium">{t('admin.health.db.label')}</span>
          <span
            role={dbDown ? 'alert' : undefined}
            className={`text-sm ${dbDown ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}
          >
            {dbDown ? t('admin.health.db.down') : t('admin.health.db.up')}
          </span>
        </li>

        <li data-testid="health-version" className={`${ROW_BASE} ${ROW_OK}`}>
          <span className="text-sm font-medium">{t('admin.health.version.label')}</span>
          <span className="font-mono text-sm text-muted-foreground">{snapshot.version}</span>
        </li>

        <li data-testid="health-uptime" className={`${ROW_BASE} ${ROW_OK}`}>
          <span className="text-sm font-medium">{t('admin.health.uptime.label')}</span>
          <span className="text-sm text-muted-foreground">
            {formatUptime(snapshot.uptimeSeconds)}
          </span>
        </li>

        <li
          data-testid="health-collab"
          data-state={snapshot.collabBridge}
          className={`${ROW_BASE} ${collabRowClass(snapshot.collabBridge)}`}
        >
          <div className="min-w-0">
            <span className="text-sm font-medium">{t('admin.health.collab.label')}</span>
            {snapshot.collabBridge !== 'connected' ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {snapshot.collabBridge === 'unconfigured'
                  ? t('admin.health.collab.unconfiguredHint')
                  : t('admin.health.collab.unreachableHint')}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 text-sm text-muted-foreground">
            {snapshot.collabBridge === 'connected'
              ? t('admin.health.collab.connected')
              : snapshot.collabBridge === 'unreachable'
                ? t('admin.health.collab.unreachable')
                : t('admin.health.collab.unconfigured')}
          </span>
        </li>
      </ul>

      <p data-testid="health-probe-note" className="mt-4 text-xs text-muted-foreground">
        {t('admin.health.probeNote')}{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">{'/healthz'}</code>
        {'. '}
        {t('admin.health.probeNoteLegacy')}
      </p>
    </div>
  );
}
