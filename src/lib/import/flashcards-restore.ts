import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { ArchiveCard, FlashcardsArchive } from '@/lib/export/flashcards-archive';
import { ensureDefaultDeck } from '@/lib/flashcards/decks';

/**
 * Restore the flashcards section of a workspace archive into a target
 * workspace (v0.10.2 F1 Task D). Runs after pages have been persisted.
 *
 * Match keys:
 *   - ATTACHED cards (exported `pageId != null`): translate the exported source
 *     page id through `pageIdRemap` to the restored page id, then upsert the
 *     card keyed by `(restored page id, block_id)` — the same key the
 *     page-save reconcile loop uses, so a subsequent edit lines up on the same
 *     row. If the source page wasn't in this archive (remap miss), the card is
 *     restored as a standalone (page-less) card so its review history survives.
 *   - STANDALONE / ORPHANED cards (exported `pageId == null`): inserted
 *     page-less and matched for review-state purposes by their ORIGINAL card id
 *     (the export's stable key for page-less cards).
 *
 * Per-user SM-2 review rows are keyed by user EMAIL → resolved to a user id in
 * the target. Review rows whose email doesn't resolve to a workspace member are
 * skipped (counted as a warning by the caller).
 */
export type FlashcardsRestoreResult = {
  decks: number;
  cards: number;
  reviews: number;
  /** Review rows skipped because their user email didn't resolve. */
  skippedReviews: number;
};

type Tx = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert' | 'update'>;

export async function restoreFlashcards(
  tx: Tx,
  input: {
    workspaceId: string;
    actorUserId: string;
    archive: FlashcardsArchive;
    /** original page id → freshly-minted page id (from the page-id remap). */
    pageIdRemap: Map<string, string>;
  },
): Promise<FlashcardsRestoreResult> {
  const { workspaceId, actorUserId, archive, pageIdRemap } = input;
  const result: FlashcardsRestoreResult = { decks: 0, cards: 0, reviews: 0, skippedReviews: 0 };

  // 1. Decks — ensure Default, then create any missing named decks. Build a
  //    name → id map so cards can be (re)attached to their deck by name.
  const defaultDeck = await ensureDefaultDeck(tx, workspaceId);
  const deckIdByName = new Map<string, string>([[defaultDeck.name, defaultDeck.id]]);
  for (const deck of archive.decks) {
    const name = deck.name?.trim();
    if (!name || deckIdByName.has(name)) continue;
    const [row] = await tx
      .insert(schema.flashcardDecks)
      .values({ workspaceId, name })
      .onConflictDoNothing({
        target: [schema.flashcardDecks.workspaceId, schema.flashcardDecks.name],
      })
      .returning({ id: schema.flashcardDecks.id, name: schema.flashcardDecks.name });
    if (row) {
      deckIdByName.set(row.name, row.id);
      result.decks += 1;
    }
  }
  // Backfill any deck names referenced by cards that we didn't just insert
  // (e.g. a name that collided on conflict, or a deck that pre-existed).
  const existingDecks = await tx
    .select({ id: schema.flashcardDecks.id, name: schema.flashcardDecks.name })
    .from(schema.flashcardDecks)
    .where(eq(schema.flashcardDecks.workspaceId, workspaceId));
  for (const d of existingDecks) deckIdByName.set(d.name, d.id);

  // 2. Resolve user emails → ids once (workspace members only). Review rows for
  //    non-members are skipped.
  const emails = Array.from(
    new Set(archive.cards.flatMap((c) => c.reviews.map((r) => r.userEmail))),
  );
  const userIdByEmail = new Map<string, string>();
  if (emails.length) {
    const memberUsers = await tx
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .innerJoin(schema.workspaceMembers, eq(schema.workspaceMembers.userId, schema.users.id))
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          inArray(schema.users.email, emails),
        ),
      );
    for (const u of memberUsers) userIdByEmail.set(u.email, u.id);
  }

  // 3. Cards — insert each, then its review rows.
  for (const card of archive.cards) {
    const restoredPageId = card.pageId ? (pageIdRemap.get(card.pageId) ?? null) : null;
    const deckId = card.deckName ? (deckIdByName.get(card.deckName) ?? null) : null;

    const newCardId = await upsertRestoredCard(tx, {
      workspaceId,
      actorUserId,
      card,
      pageId: restoredPageId,
      deckId,
    });
    result.cards += 1;

    for (const review of card.reviews) {
      const userId = userIdByEmail.get(review.userEmail);
      if (!userId) {
        result.skippedReviews += 1;
        continue;
      }
      await tx
        .insert(schema.flashcardReviews)
        .values({
          cardId: newCardId,
          userId,
          ease: review.ease,
          interval: review.interval,
          reps: review.reps,
          dueAt: new Date(review.dueAt),
          lastReviewedAt: review.lastReviewedAt ? new Date(review.lastReviewedAt) : null,
          lastGrade: review.lastGrade,
        })
        .onConflictDoNothing({
          target: [schema.flashcardReviews.cardId, schema.flashcardReviews.userId],
        });
      result.reviews += 1;
    }
  }

  return result;
}

/**
 * Insert a restored card. Attached cards (pageId set) are keyed by
 * `(page_id, block_id)`; if a row already exists (e.g. a prior reconcile during
 * page persist) it's updated rather than duplicated. Page-less cards are always
 * inserted fresh.
 */
async function upsertRestoredCard(
  tx: Tx,
  input: {
    workspaceId: string;
    actorUserId: string;
    card: ArchiveCard;
    pageId: string | null;
    deckId: string | null;
  },
): Promise<string> {
  const { workspaceId, actorUserId, card, pageId, deckId } = input;
  // A card whose source page didn't survive (remap miss) or that was already
  // orphaned at export becomes page-less; stamp it orphaned so it surfaces in
  // the orphans view and stays out of the due queue until reattached.
  const sourceOrphanedAt = card.sourceOrphanedAt
    ? new Date(card.sourceOrphanedAt)
    : card.pageId && pageId === null
      ? new Date()
      : null;

  if (pageId) {
    const [existing] = await tx
      .select({ id: schema.flashcardCards.id })
      .from(schema.flashcardCards)
      .where(
        and(
          eq(schema.flashcardCards.pageId, pageId),
          eq(schema.flashcardCards.blockId, card.blockId),
        ),
      )
      .limit(1);
    if (existing) {
      await tx
        .update(schema.flashcardCards)
        .set({
          front: card.front,
          back: card.back,
          deckId,
          tags: card.tags,
          suspendedAt: card.suspendedAt ? new Date(card.suspendedAt) : null,
          sourceOrphanedAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.flashcardCards.id, existing.id));
      return existing.id;
    }
  }

  const [row] = await tx
    .insert(schema.flashcardCards)
    .values({
      pageId,
      workspaceId,
      blockId: card.blockId,
      front: card.front,
      back: card.back,
      deckId,
      tags: card.tags,
      suspendedAt: card.suspendedAt ? new Date(card.suspendedAt) : null,
      sourceOrphanedAt,
      createdBy: actorUserId,
    })
    .returning({ id: schema.flashcardCards.id });
  if (!row) throw new Error('restoreFlashcards: card insert returned no row');
  return row.id;
}
