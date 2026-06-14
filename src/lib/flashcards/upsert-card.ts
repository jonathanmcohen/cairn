import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { ensureDefaultDeck } from './decks';

type Db = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert' | 'update'>;

export type UpsertCardInput = {
  pageId: string;
  workspaceId: string;
  blockId: string;
  front: string;
  back: string;
  deckTag: string | null;
  createdBy: string;
  // v0.10.2 F2-D — the canonical card this block references (if any) and the
  // INSERT-TIME deck hint stamped by the editor's insert dialog (used only when
  // a brand-new card is created).
  cardId?: string | null;
  deckId?: string | null;
};

/**
 * Resolve (and write through to) the `flashcard_cards` row for one live
 * flashcard block. Called from the page-save reconcile loop.
 *
 * v0.10.2 F2-D — the CARD is canonical and the block is a reference:
 *
 *   - If the block carries a `cardId` AND that card exists in this workspace,
 *     resolve THAT card. Write the block's front/back into it (block content
 *     edits flow to the card), refresh its `(page_id, block_id)` to the current
 *     page/block (handles a card moved between pages), and clear
 *     `source_orphaned_at` (the block is live again). The card's `deck_id` is
 *     DELIBERATELY NOT touched — deck is managed via the manage/decks UI; the
 *     block's `deckId` attr is only an insert hint.
 *
 *   - Otherwise (no `cardId`, or a `cardId` that no longer resolves — e.g. a
 *     deleted card / cross-workspace tamper): fall back to the legacy
 *     `(page_id, block_id)` lookup. Adopt the existing row (pre-F2 block) or
 *     INSERT a new card whose deck is the block's `deckId` hint if present, else
 *     the workspace Default deck (`ensureDefaultDeck`).
 *
 * Returns the resolved/created card. The caller backfills `card.id` into the
 * block when the block had no (resolvable) `cardId`, so the next reconcile
 * resolves by reference and never re-mints (convergence).
 *
 * Pure helper — no transaction; the caller's page-save tx encloses it.
 */
export async function upsertCard(db: Db, input: UpsertCardInput): Promise<schema.FlashcardCard> {
  // 1. Resolve by cardId (the canonical reference) when the block carries one.
  if (input.cardId) {
    const [byId] = await db
      .select()
      .from(schema.flashcardCards)
      .where(
        and(
          eq(schema.flashcardCards.id, input.cardId),
          eq(schema.flashcardCards.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (byId) {
      const [row] = await db
        .update(schema.flashcardCards)
        .set({
          front: input.front,
          back: input.back,
          // Block content edits flow to the card. Deck is NOT overwritten here.
          pageId: input.pageId,
          blockId: input.blockId,
          sourceOrphanedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.flashcardCards.id, byId.id))
        .returning();
      if (!row) throw new Error('flashcard upsert: cardId update returned no row');
      return row;
    }
    // cardId did not resolve in this workspace — fall through to the legacy
    // path so the block is re-adopted / re-minted rather than silently dropped.
  }

  // 2. Legacy / new path: look up by (page_id, block_id).
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
        sourceOrphanedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.flashcardCards.id, existing.id))
      .returning();
    if (!row) throw new Error('flashcard upsert: update returned no row');
    return row;
  }

  // INSERT a brand-new card. Deck = the block's hint if present, else Default.
  const deckId = input.deckId ?? (await ensureDefaultDeck(db, input.workspaceId)).id;
  const [row] = await db
    .insert(schema.flashcardCards)
    .values({
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      blockId: input.blockId,
      front: input.front,
      back: input.back,
      deckTag: input.deckTag,
      deckId,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error('flashcard upsert: insert returned no row');
  return row;
}
