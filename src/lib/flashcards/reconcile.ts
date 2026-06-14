import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { extractFlashcardBlocks, type FlashcardBlock, stampCardIdOnBlock } from './extract';
import { upsertCard } from './upsert-card';

type Tx = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'delete' | 'insert' | 'update'>;

// Re-export the dependency-free block extractor (moved to ./extract so the
// collab process can import it without the Drizzle/@-db-schema graph) so the
// existing REST-path importers of `@/lib/flashcards/reconcile` keep working.
export { extractFlashcardBlocks, type FlashcardBlock };

/**
 * Sync `flashcard_cards` rows with the flashcard blocks present in the saved
 * page content. Mirrors `reindexPageLinks`: inside the same transaction as the
 * page update so a failed reconcile rolls back the content write.
 *
 *   - any flashcard block in the doc → upsert into `flashcard_cards` keyed
 *     by `(page_id, block_id)`.
 *   - any existing card whose block-id is no longer in the doc → ORPHAN-MARK
 *     (set `source_orphaned_at = now()`), NOT delete.
 *
 * v0.10.2 F1 — block removal no longer HARD-DELETEs the card (which cascaded
 * away its `flashcard_reviews` and destroyed every user's SM-2 history on a
 * single save). Instead the card is stamped orphaned: it leaves the due queue /
 * notify scan but its review history survives, and it surfaces in the manage
 * view's "orphaned" filter for the user to reattach, keep, or delete. Already
 * orphaned cards are left untouched (the `source_orphaned_at IS NULL` guard
 * keeps the original timestamp).
 */
export async function reconcileFlashcards(
  tx: Tx,
  input: {
    pageId: string;
    workspaceId: string;
    userId: string;
    content: unknown;
  },
): Promise<{ contentChanged: boolean }> {
  const blocks = extractFlashcardBlocks(input.content);
  // The set of card ids resolved this pass — used both to backfill the blocks
  // that lacked a (resolvable) cardId AND to keep those cards out of the
  // orphan-mark sweep.
  const liveCardIds: string[] = [];
  let contentChanged = false;
  for (const b of blocks) {
    const card = await upsertCard(tx as never, {
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      blockId: b.blockId,
      front: b.front,
      back: b.back,
      deckTag: b.deckTag,
      createdBy: input.userId,
      cardId: b.cardId,
      deckId: b.deckId,
    });
    liveCardIds.push(card.id);
    // Backfill the resolved card id onto the block when it had none (or an
    // unresolvable one). stampCardIdOnBlock is idempotent: once the block holds
    // the right cardId it returns false, so the next reconcile changes nothing
    // (convergence — no infinite backfill loop).
    if (b.cardId !== card.id) {
      if (stampCardIdOnBlock(input.content, b.blockId, card.id)) contentChanged = true;
    }
  }
  // Orphan-mark cards on this page that no live block resolves to — by neither
  // block id (the legacy join, refreshed to a live id for resolved cards) nor
  // card id. Keeps the row + its review history (F1 semantics); only stamps
  // cards not already orphaned.
  // Every block resolves to exactly one card, so liveBlockIds and liveCardIds
  // are non-empty together or empty together.
  const liveBlockIds = blocks.map((b) => b.blockId);
  const pageGuard = eq(schema.flashcardCards.pageId, input.pageId);
  const notOrphaned = isNull(schema.flashcardCards.sourceOrphanedAt);
  const removedFilter =
    blocks.length === 0
      ? and(pageGuard, notOrphaned)
      : and(
          pageGuard,
          notOrphaned,
          notInArray(schema.flashcardCards.blockId, liveBlockIds),
          notInArray(schema.flashcardCards.id, liveCardIds),
        );
  await tx
    .update(schema.flashcardCards)
    .set({ sourceOrphanedAt: sql`now()`, updatedAt: sql`now()` })
    .where(removedFilter);
  return { contentChanged };
}
