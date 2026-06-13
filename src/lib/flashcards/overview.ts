import { and, desc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * Flashcards OVERVIEW read helpers (v0.10.2 F1 Task C).
 *
 * Powers the `/flashcards` landing page: the headline counts (due now / new /
 * mature) and the "recent activity" strip, both scoped to the active workspace
 * AND the requesting user (review state is per-(card, user), so counts differ
 * per member).
 *
 * Eligibility mirrors the due queue (`due-queue.ts`): an orphaned, suspended,
 * or trashed-source card is NOT a study target, so it counts toward none of the
 * three buckets. Cards with no review row yet are "brand new" (immediately due).
 *
 * Bucket definitions:
 *   - due now : eligible AND (no review row OR due_at <= now)
 *   - new     : eligible AND (no review row OR reps = 0)
 *   - mature  : eligible AND interval >= 21 days (the SM-2 graduation interval,
 *               shared with `manage.ts#LEARNING_GRADUATION_INTERVAL`)
 *
 * "due now" and "new" overlap (a brand-new card is both), by design — they are
 * independent headline figures, not a partition.
 *
 * All helpers are db-injected and pure (the caller passes `now`) so they can be
 * unit-tested against a real Postgres without HTTP or a clock.
 */

type Db = Pick<PostgresJsDatabase<typeof schema>, 'select'>;

/** interval (days) >= this is a "mature"/"review" card — see manage.ts. */
export const MATURE_INTERVAL_DAYS = 21;

export type OverviewCounts = {
  due: number;
  new: number;
  mature: number;
  /** Total eligible (non-orphaned, non-suspended, live-source) cards. */
  total: number;
};

/**
 * Headline counts for the overview page. One pass over the eligible cards
 * (LEFT JOIN the user's review row + INNER JOIN the live source page), tallying
 * the three (overlapping) buckets in SQL `COUNT(...) FILTER`.
 */
export async function getOverviewCounts(
  db: Db,
  workspaceId: string,
  userId: string,
  now: Date = new Date(),
): Promise<OverviewCounts> {
  const due = schema.flashcardReviews.dueAt;
  const reps = schema.flashcardReviews.reps;
  const interval = schema.flashcardReviews.interval;

  // Build the FILTER predicates with Drizzle operators (not bare `${now}`
  // interpolation) so the Date param is bound as a timestamp — postgres-js
  // rejects a raw JS Date interpolated directly into a `sql` template.
  const dueFilter = or(isNull(due), lte(due, now));
  const newFilter = or(isNull(reps), eq(reps, 0));
  const matureFilter = gte(interval, MATURE_INTERVAL_DAYS);

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${dueFilter})::int`,
      newCount: sql<number>`count(*) filter (where ${newFilter})::int`,
      mature: sql<number>`count(*) filter (where ${matureFilter})::int`,
    })
    .from(schema.flashcardCards)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.flashcardCards.pageId))
    .leftJoin(
      schema.flashcardReviews,
      and(
        eq(schema.flashcardReviews.cardId, schema.flashcardCards.id),
        eq(schema.flashcardReviews.userId, userId),
      ),
    )
    .where(
      and(
        eq(schema.flashcardCards.workspaceId, workspaceId),
        isNull(schema.flashcardCards.sourceOrphanedAt),
        isNull(schema.flashcardCards.suspendedAt),
        isNull(schema.pages.deletedAt),
      ),
    );

  return {
    total: row?.total ?? 0,
    due: row?.due ?? 0,
    new: row?.newCount ?? 0,
    mature: row?.mature ?? 0,
  };
}

export type RecentReview = {
  cardId: string;
  front: string;
  back: string;
  pageId: string | null;
  pageTitle: string | null;
  lastReviewedAt: Date;
  lastGrade: number | null;
};

/**
 * The requesting user's most-recently-reviewed cards in this workspace
 * (last_reviewed_at DESC). Orphaned cards are still shown — a card the user
 * studied yesterday that got orphaned today is legitimately "recent activity";
 * the orphan flag is surfaced separately on the orphans page.
 */
export async function listRecentReviews(
  db: Db,
  workspaceId: string,
  userId: string,
  limit = 5,
): Promise<RecentReview[]> {
  const rows = await db
    .select({
      cardId: schema.flashcardCards.id,
      front: schema.flashcardCards.front,
      back: schema.flashcardCards.back,
      pageId: schema.flashcardCards.pageId,
      pageTitle: schema.pages.title,
      lastReviewedAt: schema.flashcardReviews.lastReviewedAt,
      lastGrade: schema.flashcardReviews.lastGrade,
    })
    .from(schema.flashcardReviews)
    .innerJoin(schema.flashcardCards, eq(schema.flashcardCards.id, schema.flashcardReviews.cardId))
    .leftJoin(schema.pages, eq(schema.pages.id, schema.flashcardCards.pageId))
    .where(
      and(
        eq(schema.flashcardReviews.userId, userId),
        eq(schema.flashcardCards.workspaceId, workspaceId),
        isNotNull(schema.flashcardReviews.lastReviewedAt),
      ),
    )
    .orderBy(desc(schema.flashcardReviews.lastReviewedAt))
    .limit(limit);

  return rows
    .filter((r): r is typeof r & { lastReviewedAt: Date } => r.lastReviewedAt !== null)
    .map((r) => ({
      cardId: r.cardId,
      front: r.front,
      back: r.back,
      pageId: r.pageId,
      pageTitle: r.pageTitle,
      lastReviewedAt: r.lastReviewedAt,
      lastGrade: r.lastGrade,
    }));
}

/**
 * Total card count in the workspace IGNORING eligibility — used only to
 * distinguish "this workspace has no cards at all" (true empty state) from
 * "all the cards are orphaned/suspended" (counts are 0 but there's still
 * something to manage on the orphans page).
 */
export async function countAllCards(db: Db, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.flashcardCards)
    .where(eq(schema.flashcardCards.workspaceId, workspaceId));
  return row?.total ?? 0;
}
