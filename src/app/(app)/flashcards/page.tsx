import { redirect } from 'next/navigation';
import { FlashcardsOverviewClient } from '@/components/flashcards/overview-client';
import type { OverviewCountsDto, RecentReviewDto } from '@/components/flashcards/types';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { countAllCards, getOverviewCounts, listRecentReviews } from '@/lib/flashcards/overview';

export const dynamic = 'force-dynamic';

/**
 * /flashcards overview (v0.10.2 F1 Task C) — the landing surface for the
 * flashcards section. SSRs the calling user's headline counts (due / new /
 * mature), the most-recently-reviewed cards, and the total card count (so the
 * client can show a "no cards at all" empty state vs. "nothing due right now").
 * All figures are workspace-scoped + per-user via the Task C `overview.ts`
 * helpers. Access: any workspace member (matches the study + manage routes).
 */
export default async function FlashcardsOverviewPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');

  const db = getDb();
  const [counts, recent, totalCards] = await Promise.all([
    getOverviewCounts(db, ctx.workspaceId, ctx.userId),
    listRecentReviews(db, ctx.workspaceId, ctx.userId, 5),
    countAllCards(db, ctx.workspaceId),
  ]);

  const countsDto: OverviewCountsDto = {
    due: counts.due,
    new: counts.new,
    mature: counts.mature,
    total: counts.total,
  };

  const recentDto: RecentReviewDto[] = recent.map((r) => ({
    cardId: r.cardId,
    front: r.front,
    back: r.back,
    pageId: r.pageId,
    pageTitle: r.pageTitle,
    lastReviewedAt: r.lastReviewedAt.toISOString(),
    lastGrade: r.lastGrade,
  }));

  return <FlashcardsOverviewClient counts={countsDto} recent={recentDto} totalCards={totalCards} />;
}
