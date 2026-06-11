'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { formatBytes } from '@/lib/quotas/format';

/**
 * v0.10.0 D6 — workspace storage usage meter. Self-fetching client component
 * over GET /api/storage/usage (viewer-gated, so every member surface can mount
 * it). Renders a labeled percentage bar against the admin-set limit, an
 * "Unlimited" line when no limit is set, and warning styling from 90% up.
 *
 * `refreshKey` lets a parent (the admin storage view) force a refetch after a
 * PATCH/reconcile without lifting the fetch out of the card — bump the number
 * and the effect re-runs.
 *
 * A11y: the bar carries role="meter" + aria-valuenow/min/max (the repo bans
 * raw native form/progress elements; the shared ui/ set has no Progress
 * primitive, so this is the same hand-rolled pattern with explicit ARIA).
 */

export type StorageUsage = { usedBytes: number; limitBytes: number | null };

const WARN_AT = 0.9;

export function StorageUsageCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useT();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // refreshKey rides along as a cache-buster; bumping it re-runs this
        // effect (the admin view bumps it after PATCH/reconcile).
        const res = await fetch(`/api/storage/usage?r=${refreshKey}`);
        if (!res.ok) throw new Error(`usage fetch failed: ${res.status}`);
        const body = (await res.json()) as StorageUsage;
        if (!cancelled) {
          setUsage(body);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const limited = usage !== null && usage.limitBytes !== null;
  const fraction =
    usage !== null && usage.limitBytes !== null && usage.limitBytes > 0
      ? Math.min(1, usage.usedBytes / usage.limitBytes)
      : usage !== null && usage.limitBytes === 0
        ? 1
        : 0;
  const nearLimit = limited && fraction >= WARN_AT;
  const percentLabel = `${Math.round(fraction * 100)}%`;

  return (
    <section
      data-testid="storage-usage-card"
      className={`rounded border p-4 ${nearLimit ? 'border-warning/40 bg-warning/10' : 'bg-card'}`}
    >
      <h2 className="text-sm font-medium">{t('storage.usage.title')}</h2>

      {failed ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t('storage.usage.error')}
        </p>
      ) : usage === null ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('storage.usage.loading')}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <p data-testid="storage-usage-summary" className="text-sm text-muted-foreground">
            {usage.limitBytes === null
              ? t('storage.usage.usedUnlimited', { used: formatBytes(usage.usedBytes) })
              : t('storage.usage.usedOfLimit', {
                  used: formatBytes(usage.usedBytes),
                  limit: formatBytes(usage.limitBytes),
                })}
          </p>
          {usage.limitBytes === null ? (
            <p className="text-sm font-medium">{t('storage.usage.unlimited')}</p>
          ) : (
            <>
              {/* biome-ignore lint/a11y/useSemanticElements: a native meter element cannot be themed consistently across browsers (its fill ignores the Tailwind tokens, including the >=90% warning tint), and the repo bans raw native form/progress controls; role="meter" + explicit aria-value* on a styled div is the equivalent ARIA pattern. */}
              <div
                role="meter"
                aria-label={t('storage.usage.meterLabel')}
                aria-valuemin={0}
                aria-valuemax={usage.limitBytes}
                aria-valuenow={Math.min(usage.usedBytes, usage.limitBytes)}
                aria-valuetext={t('storage.usage.usedOfLimit', {
                  used: formatBytes(usage.usedBytes),
                  limit: formatBytes(usage.limitBytes),
                })}
                data-testid="storage-usage-meter"
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={`h-full rounded-full ${nearLimit ? 'bg-warning' : 'bg-primary'}`}
                  style={{ width: percentLabel }}
                />
              </div>
              <p className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{percentLabel}</span>
                <span>
                  {t('storage.usage.remaining', {
                    remaining: formatBytes(Math.max(0, usage.limitBytes - usage.usedBytes)),
                  })}
                </span>
              </p>
              {nearLimit ? (
                <p
                  role="status"
                  data-testid="storage-usage-warning"
                  className="text-sm font-medium text-warning"
                >
                  {t('storage.usage.nearLimit', {
                    remaining: formatBytes(Math.max(0, usage.limitBytes - usage.usedBytes)),
                  })}
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}
