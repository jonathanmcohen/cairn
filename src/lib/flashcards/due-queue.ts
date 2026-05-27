import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type DueCard = {
  id: string;
  pageId: string;
  workspaceId: string;
  blockId: string;
  front: string;
  back: string;
  deckTag: string | null;
  ease: number;
  interval: number;
};

export type ListDueOpts = {
  deckTag?: string;
  workspaceId?: string;
  now?: Date;
};

/**
 * Return cards due for review for a given user. LEFT JOIN reviews on
 * `(card_id, user_id)`: cards with no review row yet are "brand new" and
 * count as immediately due. Cards whose `due_at` is in the future are
 * filtered out.
 *
 * `opts.deckTag` filters by `flashcard_cards.deck_tag`.
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
  ];
  if (opts.deckTag) filters.push(eq(schema.flashcardCards.deckTag, opts.deckTag));
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
      ease: schema.flashcardReviews.ease,
      interval: schema.flashcardReviews.interval,
      dueAt: schema.flashcardReviews.dueAt,
    })
    .from(schema.flashcardCards)
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
