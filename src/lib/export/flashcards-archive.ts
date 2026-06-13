import { eq, inArray } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * Flashcards section of the workspace archive (v0.10.2 F1 / Task D). Decks,
 * cards, and per-user SM-2 review state are serialized into `flashcards.json`
 * alongside the pages/databases/files sections.
 *
 * Why a dedicated shape instead of riding the TemplatePayload remap: cards are
 * keyed to page content by a stable client-generated `block_id` that lives in
 * the page's TipTap JSON, not in any id-remapped column. The page id is freshly
 * minted on import, but the `block_id` survives the content rewrite untouched —
 * so on import we re-derive `(restored page id, block_id)` rather than carrying
 * the card id across. Per-user review state is keyed by user EMAIL (not user
 * id) so it can be remapped to a possibly-different user id in the target host.
 */

export const FLASHCARDS_ARCHIVE_PATH = 'flashcards.json';

/** Per-user SM-2 schedule, user identified by email for cross-host remap. */
export type ArchiveReview = {
  /** Email of the user whose schedule this is; remapped to a user id on import. */
  userEmail: string;
  ease: number;
  interval: number;
  reps: number;
  /** ISO-8601. */
  dueAt: string;
  /** ISO-8601 or null. */
  lastReviewedAt: string | null;
  lastGrade: number | null;
};

export type ArchiveCard = {
  /**
   * The card's original id. Used ONLY as the stable match key for standalone /
   * orphaned cards (no source page). Attached cards are matched by
   * `(page id, block_id)` instead — see `pageId`/`blockId`.
   */
  originalId: string;
  front: string;
  back: string;
  /** Deck name (not id) so import can match/create by name. Null = no deck. */
  deckName: string | null;
  tags: string[];
  blockId: string;
  /**
   * The ORIGINAL source page id, or null for standalone/orphaned cards. Import
   * remaps this through the page-id remap to find the restored page, then
   * matches the rebuilt card by `(restored page id, blockId)`.
   */
  pageId: string | null;
  /** ISO-8601 or null — when the source page/block was removed. */
  sourceOrphanedAt: string | null;
  /** ISO-8601 or null — when the card was suspended. */
  suspendedAt: string | null;
  reviews: ArchiveReview[];
};

export type FlashcardsArchive = {
  decks: { name: string }[];
  cards: ArchiveCard[];
};

type Db = ReturnType<typeof drizzle<typeof schema>>;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Collect every deck + card + per-user review for a workspace into the
 * portable archive shape. Pure read; no secrets (front/back text, deck names,
 * SM-2 numbers, user emails only).
 */
export async function collectFlashcardsArchive(
  db: Db,
  workspaceId: string,
): Promise<FlashcardsArchive> {
  const decks = await db
    .select({ name: schema.flashcardDecks.name })
    .from(schema.flashcardDecks)
    .where(eq(schema.flashcardDecks.workspaceId, workspaceId));

  const cardRows = await db
    .select({
      id: schema.flashcardCards.id,
      front: schema.flashcardCards.front,
      back: schema.flashcardCards.back,
      deckName: schema.flashcardDecks.name,
      tags: schema.flashcardCards.tags,
      blockId: schema.flashcardCards.blockId,
      pageId: schema.flashcardCards.pageId,
      sourceOrphanedAt: schema.flashcardCards.sourceOrphanedAt,
      suspendedAt: schema.flashcardCards.suspendedAt,
    })
    .from(schema.flashcardCards)
    .leftJoin(schema.flashcardDecks, eq(schema.flashcardDecks.id, schema.flashcardCards.deckId))
    .where(eq(schema.flashcardCards.workspaceId, workspaceId));

  const cardIds = cardRows.map((c) => c.id);

  // Per-user review state joined to the user's email (the cross-host key).
  const reviewRows = cardIds.length
    ? await db
        .select({
          cardId: schema.flashcardReviews.cardId,
          userEmail: schema.users.email,
          ease: schema.flashcardReviews.ease,
          interval: schema.flashcardReviews.interval,
          reps: schema.flashcardReviews.reps,
          dueAt: schema.flashcardReviews.dueAt,
          lastReviewedAt: schema.flashcardReviews.lastReviewedAt,
          lastGrade: schema.flashcardReviews.lastGrade,
        })
        .from(schema.flashcardReviews)
        .innerJoin(schema.users, eq(schema.users.id, schema.flashcardReviews.userId))
        .where(inArray(schema.flashcardReviews.cardId, cardIds))
    : [];

  const reviewsByCard = new Map<string, ArchiveReview[]>();
  for (const r of reviewRows) {
    const list = reviewsByCard.get(r.cardId) ?? [];
    list.push({
      userEmail: r.userEmail,
      ease: r.ease,
      interval: r.interval,
      reps: r.reps,
      dueAt: toIso(r.dueAt) ?? new Date().toISOString(),
      lastReviewedAt: toIso(r.lastReviewedAt),
      lastGrade: r.lastGrade,
    });
    reviewsByCard.set(r.cardId, list);
  }

  const cards: ArchiveCard[] = cardRows.map((c) => ({
    originalId: c.id,
    front: c.front,
    back: c.back,
    deckName: c.deckName ?? null,
    tags: c.tags ?? [],
    blockId: c.blockId,
    pageId: c.pageId,
    sourceOrphanedAt: toIso(c.sourceOrphanedAt),
    suspendedAt: toIso(c.suspendedAt),
    reviews: reviewsByCard.get(c.id) ?? [],
  }));

  return { decks: decks.map((d) => ({ name: d.name })), cards };
}
