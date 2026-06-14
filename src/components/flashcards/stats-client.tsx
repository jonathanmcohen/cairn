'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { DailyCount, ForecastDay, Maturity, PerDeck, Retention } from '@/lib/flashcards/stats';
import { useT } from '@/lib/i18n/provider';
import type { TFunction } from '@/lib/i18n/t';

// ---------------------------------------------------------------------------
// Inline SVG helpers (mirrors src/app/(app)/settings/admin/api-keys/sparkline.tsx)
// ---------------------------------------------------------------------------

function Sparkline({
  values,
  t,
  width = 300,
  height = 60,
}: {
  values: number[];
  t: TFunction;
  width?: number;
  height?: number;
}) {
  if (values.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        aria-label={t('flashcards.stats.noData')}
        role="img"
        xmlns="http://www.w3.org/2000/svg"
      />
    );
  }
  const max = Math.max(1, ...values);
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  const points = values.map((v, i) => ({
    x: i * step,
    y: height - (v / max) * height,
  }));
  const d = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const sum = values.reduce((a, b) => a + b, 0);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={t('flashcards.stats.sparkline.summary', { total: sum, days: values.length })}
      role="img"
      className="text-primary"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

function MaturityBar({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) {
  const pct = max === 0 ? 0 : Math.round((count / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium tabular-nums">{count}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ForecastBar({ day, count, max }: { day: string; count: number; max: number }) {
  const pct = max === 0 ? 0 : Math.round((count / max) * 100);
  const label = new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  });
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono text-sm tabular-nums">{count}</span>
      <div className="flex h-20 w-8 items-end justify-center">
        <div
          className="w-full rounded-t bg-primary/70"
          style={{ height: `${Math.max(2, pct)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * Heatmap cell color tier by review count (GitHub-style).
 * Uses Tailwind semantic tokens only (no raw hex).
 */
function heatmapColor(count: number): string {
  if (count === 0) return 'bg-muted';
  if (count < 3) return 'bg-primary/20';
  if (count < 6) return 'bg-primary/40';
  if (count < 10) return 'bg-primary/70';
  return 'bg-primary';
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type StatsDto = {
  dailyReviews: DailyCount[];
  retention: Retention;
  maturity: Maturity;
  heatmap: DailyCount[];
  perDeck: PerDeck[];
  forecast: {
    days: ForecastDay[];
    next30: number;
  };
};

export function FlashcardsStatsClient({ stats }: { stats: StatsDto }) {
  const t = useT();

  const totalCards =
    stats.maturity.new + stats.maturity.learning + stats.maturity.young + stats.maturity.mature;

  const totalReviews = stats.dailyReviews.reduce((a, d) => a + d.count, 0);

  const isEmpty = totalCards === 0 && totalReviews === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-2" data-testid="flashcards-stats">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-semibold">{t('flashcards.stats.title')}</h1>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" asChild>
            {/* F3-C export route — a real download (no JS); the e2e clicks this. */}
            <a href="/api/flashcards/export/apkg" download data-testid="flashcards-export-apkg">
              {t('flashcards.manage.exportApkg')}
            </a>
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={'/flashcards' as Route}>{t('flashcards.overview.nav.study')}</Link>
          </Button>
        </div>
      </div>

      {/* Caveat */}
      <p className="text-sm text-muted-foreground">{t('flashcards.stats.caveat')}</p>

      {isEmpty && <p className="text-muted-foreground">{t('flashcards.stats.empty')}</p>}

      {/* Daily reviews sparkline */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-base font-medium">{t('flashcards.stats.dailyReviews.title')}</h2>
        <Sparkline values={stats.dailyReviews.map((d) => d.count)} t={t} width={600} height={60} />
      </section>

      {/* Retention */}
      <section className="rounded-lg border bg-card p-4 shadow-sm" data-testid="stats-retention">
        <h2 className="mb-3 text-base font-medium">{t('flashcards.stats.retention.title')}</h2>
        {stats.retention.percent === null ? (
          <p className="text-4xl font-bold tabular-nums text-muted-foreground">
            {t('flashcards.stats.retention.empty')}
          </p>
        ) : (
          <p className="text-4xl font-bold tabular-nums text-primary">{stats.retention.percent}%</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {t('flashcards.stats.retention.inWindow', { count: stats.retention.total })}
        </p>
      </section>

      {/* Maturity histogram */}
      <section className="rounded-lg border bg-card p-4 shadow-sm" data-testid="stats-maturity">
        <h2 className="mb-3 text-base font-medium">{t('flashcards.stats.maturity.title')}</h2>
        <div className="space-y-3">
          <MaturityBar
            label={t('flashcards.stats.maturity.new')}
            count={stats.maturity.new}
            max={totalCards}
            color="bg-muted-foreground"
          />
          <MaturityBar
            label={t('flashcards.stats.maturity.learning')}
            count={stats.maturity.learning}
            max={totalCards}
            color="bg-destructive/60"
          />
          <MaturityBar
            label={t('flashcards.stats.maturity.young')}
            count={stats.maturity.young}
            max={totalCards}
            color="bg-primary/50"
          />
          <MaturityBar
            label={t('flashcards.stats.maturity.mature')}
            count={stats.maturity.mature}
            max={totalCards}
            color="bg-primary"
          />
        </div>
      </section>

      {/* Heatmap */}
      <section className="rounded-lg border bg-card p-4 shadow-sm" data-testid="stats-heatmap">
        <h2 className="mb-3 text-base font-medium">{t('flashcards.stats.heatmap.title')}</h2>
        <div className="flex flex-wrap gap-0.5">
          {stats.heatmap.map((cell) => (
            <div
              key={cell.date}
              className={`h-3 w-3 rounded-sm ${heatmapColor(cell.count)}`}
              title={`${cell.date}: ${cell.count}`}
              data-testid="heatmap-cell"
              data-count={cell.count}
            />
          ))}
        </div>
      </section>

      {/* Per-deck table */}
      <section className="rounded-lg border bg-card p-4 shadow-sm" data-testid="stats-per-deck">
        <h2 className="mb-3 text-base font-medium">{t('flashcards.stats.perDeck.title')}</h2>
        {stats.perDeck.length === 0 ? (
          <p className="text-muted-foreground">{t('flashcards.stats.perDeck.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 font-medium">{t('flashcards.stats.perDeck.col.deck')}</th>
                <th className="pb-2 font-medium tabular-nums">
                  {t('flashcards.stats.perDeck.col.reviews')}
                </th>
                <th className="pb-2 font-medium tabular-nums">
                  {t('flashcards.stats.perDeck.col.retention')}
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.perDeck.map((row) => (
                <tr key={row.deckId} className="border-b last:border-0">
                  <td className="py-1.5">{row.deckName}</td>
                  <td className="py-1.5 tabular-nums">{row.reviews}</td>
                  <td className="py-1.5 tabular-nums">
                    {row.retentionPercent === null ? '—' : `${row.retentionPercent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Forecast */}
      <section className="rounded-lg border bg-card p-4 shadow-sm" data-testid="stats-forecast">
        <h2 className="mb-3 text-base font-medium">{t('flashcards.stats.forecast.title')}</h2>
        <div className="mb-4 flex items-end gap-4">
          {stats.forecast.days.map((day) => (
            <ForecastBar
              key={day.date}
              day={day.date}
              count={day.count}
              max={Math.max(1, ...stats.forecast.days.map((d) => d.count))}
            />
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {t('flashcards.stats.forecast.next30').replace('{count}', String(stats.forecast.next30))}
        </p>
      </section>
    </div>
  );
}
