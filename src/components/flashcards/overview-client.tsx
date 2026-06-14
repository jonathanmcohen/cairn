'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state/empty-state';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';
import type { OverviewCountsDto, RecentReviewDto } from './types';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/**
 * /flashcards overview client (v0.10.2 F1 Task C). Renders the three headline
 * counts, a recent-activity strip, and plain links into Study / Manage /
 * Orphans. The sidebar nav that supersedes these links is Task D; here they are
 * in-page links so the section is navigable today.
 */
export function FlashcardsOverviewClient({
  counts,
  recent,
  totalCards,
}: {
  counts: OverviewCountsDto;
  recent: RecentReviewDto[];
  totalCards: number;
}) {
  const t = useT();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-2" data-testid="flashcards-overview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-semibold">{t('flashcards.overview.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" asChild>
            <Link href={'/flashcards/study' as Route}>{t('flashcards.overview.nav.study')}</Link>
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={'/flashcards/manage' as Route}>{t('flashcards.overview.nav.manage')}</Link>
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={'/flashcards/orphans' as Route}>
              {t('flashcards.overview.nav.orphans')}
            </Link>
          </Button>
        </div>
      </div>

      {totalCards === 0 ? (
        <EmptyState
          headline={t('flashcards.overview.empty.headline')}
          guidance={t('flashcards.overview.empty.guidance')}
          ctaLabel={t('flashcards.overview.empty.cta')}
          ctaHref="/search"
        />
      ) : (
        <>
          {/* Headline counts */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="flashcards-counts">
            <CountCard
              label={t('flashcards.overview.count.due')}
              value={counts.due}
              testid="count-due"
              href="/flashcards/study"
            />
            <CountCard
              label={t('flashcards.overview.count.new')}
              value={counts.new}
              testid="count-new"
            />
            <CountCard
              label={t('flashcards.overview.count.mature')}
              value={counts.mature}
              testid="count-mature"
            />
          </div>

          {/* Recent activity */}
          <section className="space-y-2">
            <h2 className="text-lg font-medium">{t('flashcards.overview.recent.title')}</h2>
            {recent.length === 0 ? (
              <p className="rounded border bg-card p-6 text-center text-sm text-muted-foreground">
                {t('flashcards.overview.recent.empty')}
              </p>
            ) : (
              <ul className="divide-y rounded border bg-card" data-testid="flashcards-recent">
                {recent.map((r) => (
                  <li
                    key={r.cardId}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate" title={r.front}>
                      {r.front}
                    </span>
                    {r.pageId ? (
                      <Link
                        href={`/pages/${r.pageId}` as Route}
                        className="shrink-0 text-primary underline"
                      >
                        {r.pageTitle?.trim() || t('flashcards.overview.recent.sourcePage')}
                      </Link>
                    ) : null}
                    <span className="shrink-0 text-muted-foreground">
                      {fmtDate(r.lastReviewedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function CountCard({
  label,
  value,
  testid,
  href,
}: {
  label: string;
  value: number;
  testid: string;
  href?: Route | string;
}) {
  const inner = (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-3xl font-semibold" data-testid={`${testid}-value`}>
        {value}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
  if (href) {
    return (
      <Link href={href as Route} className="block hover:opacity-80" data-testid={testid}>
        {inner}
      </Link>
    );
  }
  return <div data-testid={testid}>{inner}</div>;
}
