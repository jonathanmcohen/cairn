import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * Orphan helpers (v0.10.2 F1).
 *
 * A flashcard is "orphaned" when its source content is gone but its review
 * history is worth keeping: the page was permanently deleted (FK SET NULL), or
 * its `flashcard` block was removed from a live page. We stamp
 * `source_orphaned_at` rather than deleting the row, so per-user SM-2 state in
 * `flashcard_reviews` survives. Orphaned cards are excluded from the due queue
 * and notify-due scan (see due-queue.ts / notify-due.ts) and surface in the
 * manage view's "orphaned" filter for the user to reattach, keep, or delete.
 *
 * Every function is db/tx-injected and pure (no clock/`getDb()` reads beyond
 * the passed handle) so the trash, auto-purge, reconcile, and route layers can
 * share the same logic and unit-test it against a real Postgres.
 */

// Accepts either a full db handle or an enclosing transaction.
type Db = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'update' | 'delete'>;

/**
 * Stamp `source_orphaned_at = now()` on every still-attached, not-yet-orphaned
 * card belonging to the given page(s). Idempotent: re-stamping an already
 * orphaned card is skipped (the `source_orphaned_at IS NULL` guard), so the
 * original orphan timestamp is preserved.
 *
 * Call this BEFORE the page rows are physically deleted (the permanent-delete
 * path) — once the page is gone the FK has already nulled `page_id` and we can
 * no longer match cards back to their page.
 */
export async function stampOrphanedByPageIds(
  db: Db,
  pageIds: string[],
  now: Date = new Date(),
): Promise<number> {
  if (pageIds.length === 0) return 0;
  const rows = await db
    .update(schema.flashcardCards)
    .set({ sourceOrphanedAt: now, updatedAt: now })
    .where(
      and(
        inArray(schema.flashcardCards.pageId, pageIds),
        isNull(schema.flashcardCards.sourceOrphanedAt),
      ),
    )
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}

/**
 * Stamp a single card orphaned by id (used by the block-removal reconcile
 * path). Idempotent on an already-orphaned card.
 */
export async function stampOrphanedByCardIds(
  db: Db,
  cardIds: string[],
  now: Date = new Date(),
): Promise<number> {
  if (cardIds.length === 0) return 0;
  const rows = await db
    .update(schema.flashcardCards)
    .set({ sourceOrphanedAt: now, updatedAt: now })
    .where(
      and(
        inArray(schema.flashcardCards.id, cardIds),
        isNull(schema.flashcardCards.sourceOrphanedAt),
      ),
    )
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}

export type OrphanCard = {
  id: string;
  front: string;
  back: string;
  deckId: string | null;
  deckTag: string | null;
  tags: string[];
  sourceOrphanedAt: Date | null;
};

/** List orphaned cards in a workspace (newest-orphaned first). */
export async function listOrphans(db: Db, workspaceId: string): Promise<OrphanCard[]> {
  const rows = await db
    .select({
      id: schema.flashcardCards.id,
      front: schema.flashcardCards.front,
      back: schema.flashcardCards.back,
      deckId: schema.flashcardCards.deckId,
      deckTag: schema.flashcardCards.deckTag,
      tags: schema.flashcardCards.tags,
      sourceOrphanedAt: schema.flashcardCards.sourceOrphanedAt,
    })
    .from(schema.flashcardCards)
    .where(
      and(
        eq(schema.flashcardCards.workspaceId, workspaceId),
        isNotNull(schema.flashcardCards.sourceOrphanedAt),
      ),
    )
    .orderBy(sql`${schema.flashcardCards.sourceOrphanedAt} DESC`);
  return rows;
}

/**
 * Reattach an orphaned card to a (live) page: set `page_id` + clear the orphan
 * flag. The caller is responsible for validating the page lives in the same
 * workspace. `blockId` may be passed to rebind to a specific block.
 */
export async function reattachOrphan(
  db: Db,
  input: { cardId: string; pageId: string; blockId?: string },
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(schema.flashcardCards)
    .set({
      pageId: input.pageId,
      sourceOrphanedAt: null,
      updatedAt: now,
      ...(input.blockId ? { blockId: input.blockId } : {}),
    })
    .where(eq(schema.flashcardCards.id, input.cardId));
}

/**
 * Keep an orphaned card as a standalone card: clear the orphan flag but leave
 * `page_id` NULL. The card stays in the deck/review system with no source page.
 */
export async function keepOrphanStandalone(
  db: Db,
  cardId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(schema.flashcardCards)
    .set({ sourceOrphanedAt: null, updatedAt: now })
    .where(eq(schema.flashcardCards.id, cardId));
}

/**
 * Permanently remove orphaned card(s) and (via FK cascade) their review rows.
 */
export async function deleteOrphans(db: Db, cardIds: string[]): Promise<number> {
  if (cardIds.length === 0) return 0;
  const rows = await db
    .delete(schema.flashcardCards)
    .where(inArray(schema.flashcardCards.id, cardIds))
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}
