import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type UpsertCardInput = {
  pageId: string;
  workspaceId: string;
  blockId: string;
  front: string;
  back: string;
  deckTag: string | null;
  createdBy: string;
};

/**
 * Upsert a flashcard row, keyed by `(page_id, block_id)`. Called from the
 * page-save reconcile loop: if the editor inserted a new `flashcard` node
 * since last save, this inserts; if the user edited the front/back/deck of
 * an existing node, this updates and bumps `updated_at`.
 *
 * Pure helper — no transaction; the caller's page-save tx encloses it.
 */
export async function upsertCard(
  db: Db,
  input: UpsertCardInput,
): Promise<schema.FlashcardCard> {
  const [existing] = await db
    .select()
    .from(schema.flashcardCards)
    .where(
      and(
        eq(schema.flashcardCards.pageId, input.pageId),
        eq(schema.flashcardCards.blockId, input.blockId),
      ),
    )
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(schema.flashcardCards)
      .set({
        front: input.front,
        back: input.back,
        deckTag: input.deckTag,
        updatedAt: new Date(),
      })
      .where(eq(schema.flashcardCards.id, existing.id))
      .returning();
    if (!row) throw new Error('flashcard upsert: update returned no row');
    return row;
  }
  const [row] = await db
    .insert(schema.flashcardCards)
    .values({
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      blockId: input.blockId,
      front: input.front,
      back: input.back,
      deckTag: input.deckTag,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error('flashcard upsert: insert returned no row');
  return row;
}
