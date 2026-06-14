import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

/**
 * Flashcard stats read helpers (v0.10.2 F3 Task B).
 *
 * Powers the `/flashcards/stats` page. All metrics are:
 *   - Scoped to a single (userId, workspaceId) pair.
 *   - Injected `now` so unit tests control the clock.
 *
 * TIMEZONE NOTE: All date bucketing uses UTC. `to_char(... AT TIME ZONE 'UTC',
 * 'YYYY-MM-DD')` ensures a consistent date boundary regardless of the Postgres
 * server's `timezone` GUC. The `/flashcards/stats` page shows UTC dates in
 * the chart axes; a per-user timezone preference can be added later.
 */

type FullDb = PostgresJsDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export type DailyCount = { date: string; count: number };

export type Retention = { percent: number | null; total: number };

export type Maturity = { new: number; learning: number; young: number; mature: number };

export type PerDeck = {
  deckId: string;
  deckName: string;
  reviews: number;
  retentionPercent: number | null;
};

export type ForecastDay = { date: string; count: number };

export type Forecast = { days: ForecastDay[]; next30: number };

export type FlashcardStats = {
  dailyReviews: DailyCount[];
  retention: Retention;
  maturity: Maturity;
  heatmap: DailyCount[];
  perDeck: PerDeck[];
  forecast: Forecast;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return an array of `n` consecutive UTC dates ending on (and including)
 * `anchor`, formatted as 'YYYY-MM-DD', oldest first.
 */
function buildDateSeries(anchor: Date, n: number): string[] {
  const result: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(anchor.getTime() - i * 86_400_000);
    result.push(utcDate(d));
  }
  return result;
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function getFlashcardStats(
  db: FullDb,
  { userId, workspaceId, now = new Date() }: { userId: string; workspaceId: string; now?: Date },
): Promise<FlashcardStats> {
  const [dailyReviews, retention, maturity, heatmap, perDeck, forecast] = await Promise.all([
    getDailyReviews(db, userId, now),
    getRetention(db, userId, now),
    getMaturity(db, userId, workspaceId),
    getHeatmap(db, userId, now),
    getPerDeck(db, userId, workspaceId, now),
    getForecast(db, userId, workspaceId, now),
  ]);

  return { dailyReviews, retention, maturity, heatmap, perDeck, forecast };
}

// ---------------------------------------------------------------------------
// dailyReviews: last 30 days, zero-filled
// ---------------------------------------------------------------------------

async function getDailyReviews(db: FullDb, userId: string, now: Date): Promise<DailyCount[]> {
  const windowStart = new Date(now.getTime() - 30 * 86_400_000);
  // postgres-js rawSql template params must be strings/numbers, not Date objects.
  const windowStartIso = windowStart.toISOString();
  const nowIso = now.toISOString();

  const rows = (await db.execute(rawSql`
    SELECT
      to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      COUNT(*)::int                                          AS count
    FROM flashcard_review_events
    WHERE user_id       = ${userId}::uuid
      AND reviewed_at   >= ${windowStartIso}::timestamptz
      AND reviewed_at   <  ${nowIso}::timestamptz
    GROUP BY 1
  `)) as unknown as Array<{ date: string; count: number | string }>;

  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.date, Number(r.count));

  return buildDateSeries(new Date(now.getTime() - 86_400_000), 30).map((date) => ({
    date,
    count: byDate.get(date) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// retention: rolling 30-day window
// ---------------------------------------------------------------------------

async function getRetention(db: FullDb, userId: string, now: Date): Promise<Retention> {
  const windowStart = new Date(now.getTime() - 30 * 86_400_000);
  const windowStartIso = windowStart.toISOString();
  const nowIso = now.toISOString();

  const [row] = (await db.execute(rawSql`
    SELECT
      COUNT(*)::int                                                         AS total,
      COUNT(*) FILTER (WHERE grade >= 2)::int                              AS good
    FROM flashcard_review_events
    WHERE user_id     = ${userId}::uuid
      AND reviewed_at >= ${windowStartIso}::timestamptz
      AND reviewed_at <  ${nowIso}::timestamptz
  `)) as unknown as Array<{ total: number | string; good: number | string }>;

  const total = Number(row?.total ?? 0);
  const good = Number(row?.good ?? 0);

  if (total === 0) return { percent: null, total: 0 };
  return { percent: Math.round((100 * good) / total), total };
}

// ---------------------------------------------------------------------------
// maturity: active cards bucketed by interval
// ---------------------------------------------------------------------------

async function getMaturity(db: FullDb, userId: string, workspaceId: string): Promise<Maturity> {
  /**
   * Active card definition (mirrors due-queue.ts + decks.ts#deckCounts):
   *   - source_orphaned_at IS NULL
   *   - suspended_at IS NULL
   *   - page_id IS NULL (permanently-deleted page → orphaned, already excluded
   *     via source_orphaned_at) OR page.deleted_at IS NULL
   *
   * The INNER JOIN on pages is used in due-queue.ts; the spec says to mirror
   * that exclusion. Cards with null page_id are orphaned (source_orphaned_at
   * is set when page is permanently deleted) so the INNER JOIN naturally
   * excludes them.
   */
  const rows = (await db.execute(rawSql`
    SELECT
      COUNT(*) FILTER (WHERE r.card_id IS NULL)::int                         AS "new",
      COUNT(*) FILTER (WHERE r.card_id IS NOT NULL AND r.interval = 0)::int  AS "learning",
      COUNT(*) FILTER (WHERE r.interval >= 1 AND r.interval <= 20)::int      AS "young",
      COUNT(*) FILTER (WHERE r.interval >= 21)::int                          AS "mature"
    FROM flashcard_cards c
    INNER JOIN pages p ON p.id = c.page_id AND p.deleted_at IS NULL
    LEFT JOIN flashcard_reviews r
      ON r.card_id = c.id
     AND r.user_id = ${userId}::uuid
    WHERE c.workspace_id       = ${workspaceId}::uuid
      AND c.source_orphaned_at IS NULL
      AND c.suspended_at       IS NULL
  `)) as unknown as Array<{
    new: number | string;
    learning: number | string;
    young: number | string;
    mature: number | string;
  }>;

  const r = rows[0];
  return {
    new: Number(r?.new ?? 0),
    learning: Number(r?.learning ?? 0),
    young: Number(r?.young ?? 0),
    mature: Number(r?.mature ?? 0),
  };
}

// ---------------------------------------------------------------------------
// heatmap: last 365 days, zero-filled
// ---------------------------------------------------------------------------

async function getHeatmap(db: FullDb, userId: string, now: Date): Promise<DailyCount[]> {
  const windowStart = new Date(now.getTime() - 365 * 86_400_000);
  const windowStartIso = windowStart.toISOString();
  const nowIso = now.toISOString();

  const rows = (await db.execute(rawSql`
    SELECT
      to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      COUNT(*)::int                                          AS count
    FROM flashcard_review_events
    WHERE user_id       = ${userId}::uuid
      AND reviewed_at   >= ${windowStartIso}::timestamptz
      AND reviewed_at   <  ${nowIso}::timestamptz
    GROUP BY 1
  `)) as unknown as Array<{ date: string; count: number | string }>;

  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.date, Number(r.count));

  return buildDateSeries(new Date(now.getTime() - 86_400_000), 365).map((date) => ({
    date,
    count: byDate.get(date) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// perDeck: in-window reviews + retention per deck
// ---------------------------------------------------------------------------

async function getPerDeck(
  db: FullDb,
  userId: string,
  workspaceId: string,
  now: Date,
): Promise<PerDeck[]> {
  const windowStart = new Date(now.getTime() - 30 * 86_400_000);
  const windowStartIso = windowStart.toISOString();
  const nowIso = now.toISOString();

  /**
   * Only active cards (same exclusion as maturity) are counted toward per-deck
   * stats. Decks with 0 in-window reviews are INCLUDED (reviews:0,
   * retention:null) so the table is stable as cards mature.
   */
  const rows = (await db.execute(rawSql`
    SELECT
      d.id                                                                         AS "deckId",
      d.name                                                                       AS "deckName",
      COUNT(e.id) FILTER (WHERE e.reviewed_at >= ${windowStartIso}::timestamptz AND e.reviewed_at < ${nowIso}::timestamptz)::int
                                                                                   AS "reviews",
      COUNT(e.id) FILTER (WHERE e.reviewed_at >= ${windowStartIso}::timestamptz AND e.reviewed_at < ${nowIso}::timestamptz AND e.grade >= 2)::int
                                                                                   AS "good"
    FROM flashcard_decks d
    INNER JOIN flashcard_cards c
      ON  c.deck_id            = d.id
      AND c.workspace_id       = ${workspaceId}::uuid
      AND c.source_orphaned_at IS NULL
      AND c.suspended_at       IS NULL
    INNER JOIN pages p ON p.id = c.page_id AND p.deleted_at IS NULL
    LEFT JOIN flashcard_review_events e
      ON  e.card_id  = c.id
      AND e.user_id  = ${userId}::uuid
    WHERE d.workspace_id = ${workspaceId}::uuid
    GROUP BY d.id, d.name
    ORDER BY d.name
  `)) as unknown as Array<{
    deckId: string;
    deckName: string;
    reviews: number | string;
    good: number | string;
  }>;

  return rows.map((r) => {
    const reviews = Number(r.reviews);
    const good = Number(r.good);
    return {
      deckId: r.deckId,
      deckName: r.deckName,
      reviews,
      retentionPercent: reviews === 0 ? null : Math.round((100 * good) / reviews),
    };
  });
}

// ---------------------------------------------------------------------------
// forecast: cards due in the next 7 days + 30-day total
// ---------------------------------------------------------------------------

async function getForecast(
  db: FullDb,
  userId: string,
  workspaceId: string,
  now: Date,
): Promise<Forecast> {
  /**
   * Only active cards (INNER JOIN pages, not orphaned, not suspended).
   * Overdue cards (dueAt < now) count into day 0 (today).
   * Cards with no review row at all are "new" and immediately due → day 0.
   *
   * We bucket by: days_until_due = GREATEST(0, floor(due_at - now in days))
   */
  const thirtyDaysOut = new Date(now.getTime() + 30 * 86_400_000);
  const nowIso = now.toISOString();
  const thirtyDaysOutIso = thirtyDaysOut.toISOString();

  const rows = (await db.execute(rawSql`
    SELECT
      GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (COALESCE(r.due_at, ${nowIso}::timestamptz) - ${nowIso}::timestamptz)) / 86400)
      )::int   AS "dayOffset",
      COUNT(*)::int AS "count"
    FROM flashcard_cards c
    INNER JOIN pages p ON p.id = c.page_id AND p.deleted_at IS NULL
    LEFT JOIN flashcard_reviews r
      ON  r.card_id = c.id
      AND r.user_id = ${userId}::uuid
    WHERE c.workspace_id       = ${workspaceId}::uuid
      AND c.source_orphaned_at IS NULL
      AND c.suspended_at       IS NULL
      AND COALESCE(r.due_at, ${nowIso}::timestamptz) <= ${thirtyDaysOutIso}::timestamptz
    GROUP BY 1
    ORDER BY 1
  `)) as unknown as Array<{ dayOffset: number | string; count: number | string }>;

  const byOffset = new Map<number, number>();
  let next30 = 0;
  for (const r of rows) {
    const offset = Number(r.dayOffset);
    const count = Number(r.count);
    byOffset.set(offset, count);
    next30 += count;
  }

  // Build 7-day array (offsets 0..6)
  const days: ForecastDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86_400_000);
    return { date: utcDate(d), count: byOffset.get(i) ?? 0 };
  });

  return { days, next30 };
}
