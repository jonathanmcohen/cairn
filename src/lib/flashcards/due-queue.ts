import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type DueCard = {
  id: string;
  pageId: string | null;
  workspaceId: string;
  blockId: string;
  front: string;
  back: string;
  deckTag: string | null;
  deckId: string | null;
  ease: number;
  interval: number;
};

export type ListDueOpts = {
  deckTag?: string;
  deckId?: string;
  workspaceId?: string;
  now?: Date;
};

/**
 * Return cards due for review for a given user. LEFT JOIN reviews on
 * `(card_id, user_id)`: cards with no review row yet are "brand new" and
 * count as immediately due. Cards whose `due_at` is in the future are
 * filtered out.
 *
 * v0.10.2 F1 — INNER JOINs `pages` and excludes cards that are not eligible
 * for review:
 *   - `pages.deleted_at IS NULL`: a card whose source page is in the trash
 *     (soft-deleted) leaves the due queue until the page is restored. The
 *     join is INNER, so orphaned cards (page_id NULL after a permanent delete)
 *     are also dropped — and the explicit `source_orphaned_at IS NULL` filter
 *     keeps that intent obvious / future-proof.
 *   - `source_orphaned_at IS NULL`: orphaned cards never surface in review.
 *   - `suspended_at IS NULL`: suspended cards are held out of review.
 *
 * `opts.deckTag` filters by the legacy `flashcard_cards.deck_tag`.
 * `opts.deckId` filters by the first-class `flashcard_cards.deck_id`.
 * `opts.workspaceId` restricts to a single workspace (defense in depth — the
 * caller already enforces workspace access at the route boundary).
 */
export async function listDueForUser(
  db: Db,
  userId: string,
  opts: ListDueOpts = {},
): Promise<DueCard[]> {
  const now = opts.now ?? new Date();
  const filters = [
    or(isNull(schema.flashcardReviews.dueAt), lte(schema.flashcardReviews.dueAt, now)),
    isNull(schema.flashcardCards.sourceOrphanedAt),
    isNull(schema.flashcardCards.suspendedAt),
    isNull(schema.pages.deletedAt),
  ];
  if (opts.deckTag) filters.push(eq(schema.flashcardCards.deckTag, opts.deckTag));
  if (opts.deckId) filters.push(eq(schema.flashcardCards.deckId, opts.deckId));
  if (opts.workspaceId) filters.push(eq(schema.flashcardCards.workspaceId, opts.workspaceId));

  const rows = await db
    .select({
      id: schema.flashcardCards.id,
      pageId: schema.flashcardCards.pageId,
      workspaceId: schema.flashcardCards.workspaceId,
      blockId: schema.flashcardCards.blockId,
      front: schema.flashcardCards.front,
      back: schema.flashcardCards.back,
      deckTag: schema.flashcardCards.deckTag,
      deckId: schema.flashcardCards.deckId,
      ease: schema.flashcardReviews.ease,
      interval: schema.flashcardReviews.interval,
      dueAt: schema.flashcardReviews.dueAt,
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
    .where(and(...filters))
    .orderBy(sql`${schema.flashcardReviews.dueAt} NULLS FIRST`);

  return rows.map((r) => ({
    id: r.id,
    pageId: r.pageId,
    workspaceId: r.workspaceId,
    blockId: r.blockId,
    front: r.front,
    back: r.back,
    deckTag: r.deckTag,
    deckId: r.deckId,
    ease: r.ease ?? 2.5,
    interval: r.interval ?? 0,
  }));
}

export async function countDueForUser(
  db: Db,
  userId: string,
  opts: ListDueOpts = {},
): Promise<number> {
  const rows = await listDueForUser(db, userId, opts);
  return rows.length;
}
