import { and, eq, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { extractFlashcardBlocks, type FlashcardBlock } from './extract';
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
 *   - any existing card whose block-id is no longer in the doc → delete (and
 *     cascade-deletes its review rows).
 */
export async function reconcileFlashcards(
  tx: Tx,
  input: {
    pageId: string;
    workspaceId: string;
    userId: string;
    content: unknown;
  },
): Promise<void> {
  const blocks = extractFlashcardBlocks(input.content);
  for (const b of blocks) {
    await upsertCard(tx as never, {
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      blockId: b.blockId,
      front: b.front,
      back: b.back,
      deckTag: b.deckTag,
      createdBy: input.userId,
    });
  }
  const liveBlockIds = blocks.map((b) => b.blockId);
  if (liveBlockIds.length === 0) {
    await tx.delete(schema.flashcardCards).where(eq(schema.flashcardCards.pageId, input.pageId));
  } else {
    await tx
      .delete(schema.flashcardCards)
      .where(
        and(
          eq(schema.flashcardCards.pageId, input.pageId),
          notInArray(schema.flashcardCards.blockId, liveBlockIds),
        ),
      );
  }
}
