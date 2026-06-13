import { and, asc, eq, inArray, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

/**
 * Deck management (v0.10.2 F1 + F2). Decks are first-class, named, per-workspace
 * groupings of flashcards (`flashcard_cards.deck_id`). Every workspace has a
 * seeded "Default" deck (migration 0077); `ensureDefaultDeck` recreates it
 * lazily for workspaces created after the migration.
 *
 * db-injected + pure (business logic only); the API routes are Task B.
 */

/**
 * Narrowest handle: select + insert + update — used by helpers that don't
 * need delete or transactions, allowing callers (like flashcards-restore) to
 * pass a Tx that omits delete.
 */
type ReadWriteDb = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert' | 'update'>;

/** Narrow handle: adds delete for the simple mutation helpers. */
type Db = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert' | 'update' | 'delete'>;

/** Full handle required by helpers that run transactions or raw SQL. */
type FullDb = PostgresJsDatabase<typeof schema>;

export const DEFAULT_DECK_NAME = 'Default';

export type DeckRow = {
  id: string;
  workspaceId: string;
  name: string;
  // v0.10.2 F2 — hierarchy + per-deck schedule overrides
  icon: string | null;
  color: string | null;
  parentDeckId: string | null;
  defaultNewPerDay: number | null;
  defaultReviewLimit: number | null;
  easeStart: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** List a workspace's decks, alphabetical by name. */
export async function listDecks(db: Db, workspaceId: string): Promise<DeckRow[]> {
  return db
    .select()
    .from(schema.flashcardDecks)
    .where(eq(schema.flashcardDecks.workspaceId, workspaceId))
    .orderBy(asc(schema.flashcardDecks.name));
}

/**
 * List all decks in a workspace (same as listDecks; alias for clarity in
 * contexts where "tree" intent is signalled to callers building the UI tree
 * from parentDeckId). Sort by name; the UI assembles the nested tree from
 * parentDeckId.
 */
export async function listDeckTree(db: Db, workspaceId: string): Promise<DeckRow[]> {
  return listDecks(db, workspaceId);
}

/**
 * Per-deck card-count buckets for a given user.
 *
 * Exclusions mirror due-queue.ts:
 *   - sourceOrphanedAt IS NOT NULL  → excluded
 *   - suspendedAt IS NOT NULL       → excluded
 *   - cards with no deckId          → excluded (deckId IS NULL)
 *   - cards whose source page is soft-deleted (pages.deletedAt IS NOT NULL)
 *     are NOT excluded here because the due-queue does an INNER JOIN on pages
 *     for deck counts we do a LEFT JOIN and don't filter on page existence
 *     (deck counts are for the manage/overview surface, not strictly a due queue
 *     mirror). The due-queue exclusion is preserved for the study route.
 *
 * Buckets:
 *   new      = no review row for the user (LEFT JOIN returns NULL reps)
 *   learning = has review row AND interval = 0
 *   review   = interval >= 1 AND interval < 21
 *   mature   = interval >= 21
 *
 * Implemented as a single SQL query with conditional aggregation.
 */
export type DeckCountRow = {
  deckId: string;
  new: number;
  learning: number;
  review: number;
  mature: number;
};

export async function deckCounts(
  db: FullDb,
  userId: string,
  workspaceId: string,
): Promise<DeckCountRow[]> {
  // Raw SQL for conditional aggregation (Drizzle doesn't have a clean way to
  // express FILTER clauses or CASE-in-SUM without rawSql helpers).
  const rows = (await db.execute(rawSql`
    SELECT
      c.deck_id                                                             AS "deckId",
      COUNT(*) FILTER (WHERE r.card_id IS NULL)::int                       AS "new",
      COUNT(*) FILTER (WHERE r.card_id IS NOT NULL AND r.interval = 0)::int AS "learning",
      COUNT(*) FILTER (WHERE r.interval >= 1 AND r.interval < 21)::int     AS "review",
      COUNT(*) FILTER (WHERE r.interval >= 21)::int                        AS "mature"
    FROM flashcard_cards c
    LEFT JOIN flashcard_reviews r
      ON r.card_id = c.id
     AND r.user_id = ${userId}::uuid
    WHERE c.workspace_id = ${workspaceId}::uuid
      AND c.deck_id IS NOT NULL
      AND c.source_orphaned_at IS NULL
      AND c.suspended_at IS NULL
    GROUP BY c.deck_id
  `)) as unknown as Array<{
    deckId: string;
    new: number | string;
    learning: number | string;
    review: number | string;
    mature: number | string;
  }>;

  return rows.map((r) => ({
    deckId: r.deckId,
    new: Number(r.new),
    learning: Number(r.learning),
    review: Number(r.review),
    mature: Number(r.mature),
  }));
}

/**
 * Ensure a "Default" deck exists for the workspace and return it. Idempotent:
 * if one already exists it is returned untouched; otherwise it is created. Uses
 * an ON CONFLICT DO NOTHING insert so concurrent callers can't create a
 * duplicate (the (workspace_id, name) unique constraint backs it).
 */
export async function ensureDefaultDeck(db: ReadWriteDb, workspaceId: string): Promise<DeckRow> {
  await db
    .insert(schema.flashcardDecks)
    .values({ workspaceId, name: DEFAULT_DECK_NAME })
    .onConflictDoNothing({
      target: [schema.flashcardDecks.workspaceId, schema.flashcardDecks.name],
    });
  const [row] = await db
    .select()
    .from(schema.flashcardDecks)
    .where(
      and(
        eq(schema.flashcardDecks.workspaceId, workspaceId),
        eq(schema.flashcardDecks.name, DEFAULT_DECK_NAME),
      ),
    )
    .limit(1);
  if (!row) throw new Error('ensureDefaultDeck: default deck missing after upsert');
  return row;
}

/**
 * Create a named deck in a workspace. Throws if a deck with that name already
 * exists (caller maps to a 409). The name is trimmed; empty names are rejected.
 */
export async function createDeck(db: Db, workspaceId: string, name: string): Promise<DeckRow> {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Deck name is required');
  const existing = await db
    .select({ id: schema.flashcardDecks.id })
    .from(schema.flashcardDecks)
    .where(
      and(
        eq(schema.flashcardDecks.workspaceId, workspaceId),
        eq(schema.flashcardDecks.name, trimmed),
      ),
    )
    .limit(1);
  if (existing[0]) throw new Error('A deck with that name already exists');
  const [row] = await db
    .insert(schema.flashcardDecks)
    .values({ workspaceId, name: trimmed })
    .returning();
  if (!row) throw new Error('createDeck: insert returned no row');
  return row;
}

/**
 * Rename a deck within a workspace. Throws if the new name collides with
 * another deck in the same workspace, or the deck does not exist / belongs to
 * a different workspace.
 */
export async function renameDeck(
  db: Db,
  workspaceId: string,
  deckId: string,
  name: string,
): Promise<DeckRow> {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Deck name is required');
  const clash = await db
    .select({ id: schema.flashcardDecks.id })
    .from(schema.flashcardDecks)
    .where(
      and(
        eq(schema.flashcardDecks.workspaceId, workspaceId),
        eq(schema.flashcardDecks.name, trimmed),
      ),
    )
    .limit(1);
  if (clash[0] && clash[0].id !== deckId) {
    throw new Error('A deck with that name already exists');
  }
  const [row] = await db
    .update(schema.flashcardDecks)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(
      and(eq(schema.flashcardDecks.id, deckId), eq(schema.flashcardDecks.workspaceId, workspaceId)),
    )
    .returning();
  if (!row) throw new Error('Deck not found');
  return row;
}

// ---------------------------------------------------------------------------
// v0.10.2 F2 — new deck management functions
// ---------------------------------------------------------------------------

export type SetDeckOptions = {
  icon?: string | null;
  color?: string | null;
  defaultNewPerDay?: number | null;
  defaultReviewLimit?: number | null;
  easeStart?: number | null;
};

/**
 * Update per-deck display + schedule options. Only the provided keys are
 * touched; `undefined` fields are left as-is. Explicit `null` clears the
 * field (revert to workspace default). Returns the updated row.
 * Throws "Deck not found" if the deck doesn't exist in this workspace.
 */
export async function setDeckOptions(
  db: Db,
  workspaceId: string,
  deckId: string,
  opts: SetDeckOptions,
): Promise<DeckRow> {
  // Build the SET clause from only the defined keys.
  // biome-ignore lint/suspicious/noExplicitAny: dynamic update set object
  const patch: Record<string, any> = { updatedAt: new Date() };
  if ('icon' in opts) patch.icon = opts.icon ?? null;
  if ('color' in opts) patch.color = opts.color ?? null;
  if ('defaultNewPerDay' in opts) patch.defaultNewPerDay = opts.defaultNewPerDay ?? null;
  if ('defaultReviewLimit' in opts) patch.defaultReviewLimit = opts.defaultReviewLimit ?? null;
  if ('easeStart' in opts) patch.easeStart = opts.easeStart ?? null;

  const [row] = await db
    .update(schema.flashcardDecks)
    .set(patch)
    .where(
      and(eq(schema.flashcardDecks.id, deckId), eq(schema.flashcardDecks.workspaceId, workspaceId)),
    )
    .returning();
  if (!row) throw new Error('Deck not found');
  return row;
}

/**
 * Reparent a deck (set its parentDeckId). NULL means root.
 *
 * CYCLE GUARD: rejects if parentDeckId === deckId (self-loop), or if
 * parentDeckId is a descendant of deckId (would create a cycle). The check
 * walks the descendant set of deckId via a recursive CTE in SQL, mirroring
 * the page-move cycle check in src/lib/pages/move.ts.
 *
 * Throws:
 *   "Cannot make a deck a child of itself"         → map to 400
 *   "Cycle detected: target is a descendant"       → map to 409
 *   "Deck not found"                               → map to 404
 *   "Parent deck not found"                        → map to 404
 */
export async function reparentDeck(
  db: FullDb,
  workspaceId: string,
  deckId: string,
  parentDeckId: string | null,
): Promise<DeckRow> {
  if (parentDeckId === deckId) {
    throw new Error('Cannot make a deck a child of itself');
  }

  // Verify deck exists in workspace
  const [deck] = await db
    .select({ id: schema.flashcardDecks.id })
    .from(schema.flashcardDecks)
    .where(
      and(eq(schema.flashcardDecks.id, deckId), eq(schema.flashcardDecks.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!deck) throw new Error('Deck not found');

  if (parentDeckId !== null) {
    // Verify parent exists in same workspace
    const [parent] = await db
      .select({ id: schema.flashcardDecks.id })
      .from(schema.flashcardDecks)
      .where(
        and(
          eq(schema.flashcardDecks.id, parentDeckId),
          eq(schema.flashcardDecks.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!parent) throw new Error('Parent deck not found');

    // Cycle check: is parentDeckId a descendant of deckId?
    const result = (await db.execute(rawSql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM flashcard_decks WHERE id = ${deckId}::uuid
        UNION ALL
        SELECT d.id FROM flashcard_decks d
        INNER JOIN descendants anc ON d.parent_deck_id = anc.id
      )
      SELECT count(*)::int AS count FROM descendants WHERE id = ${parentDeckId}::uuid
    `)) as unknown as { count: number }[];
    const count = Number(result[0]?.count ?? 0);
    if (count > 0) throw new Error('Cycle detected: target is a descendant');
  }

  const [row] = await db
    .update(schema.flashcardDecks)
    .set({ parentDeckId, updatedAt: new Date() })
    .where(
      and(eq(schema.flashcardDecks.id, deckId), eq(schema.flashcardDecks.workspaceId, workspaceId)),
    )
    .returning();
  if (!row) throw new Error('Deck not found');
  return row;
}

/**
 * Merge sourceDeckId INTO targetDeckId. In a transaction:
 *   1. Re-point source's cards → target.
 *   2. Reparent source's child decks → target (so they aren't orphaned by the
 *      delete; DB would SET NULL them, but that flattens the tree silently).
 *   3. Delete the source deck.
 *   4. Record an audit event (flashcard.deck_merged).
 *
 * Guards:
 *   "Cannot merge a deck into itself"              → 400
 *   "Source deck not found"                        → 404
 *   "Target deck not found"                        → 404
 *   "Cannot delete the Default deck"               → 400 (source is Default)
 *
 * SM-2 review rows on cards are deliberately untouched.
 */
export async function mergeDeck(
  db: FullDb,
  workspaceId: string,
  sourceDeckId: string,
  targetDeckId: string,
  actorUserId: string | null = null,
): Promise<{ cardsMoved: number; childrenReparented: number }> {
  if (sourceDeckId === targetDeckId) {
    throw new Error('Cannot merge a deck into itself');
  }

  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(schema.flashcardDecks)
      .where(
        and(
          eq(schema.flashcardDecks.id, sourceDeckId),
          eq(schema.flashcardDecks.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!source) throw new Error('Source deck not found');
    if (source.name === DEFAULT_DECK_NAME) throw new Error('Cannot delete the Default deck');

    const [target] = await tx
      .select({ id: schema.flashcardDecks.id })
      .from(schema.flashcardDecks)
      .where(
        and(
          eq(schema.flashcardDecks.id, targetDeckId),
          eq(schema.flashcardDecks.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!target) throw new Error('Target deck not found');

    // 1. Re-point source's cards → target
    const movedCards = await tx
      .update(schema.flashcardCards)
      .set({ deckId: targetDeckId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.flashcardCards.deckId, sourceDeckId),
          eq(schema.flashcardCards.workspaceId, workspaceId),
        ),
      )
      .returning({ id: schema.flashcardCards.id });

    // 2. Reparent source's child decks → target
    const movedChildren = await tx
      .update(schema.flashcardDecks)
      .set({ parentDeckId: targetDeckId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.flashcardDecks.parentDeckId, sourceDeckId),
          eq(schema.flashcardDecks.workspaceId, workspaceId),
        ),
      )
      .returning({ id: schema.flashcardDecks.id });

    // 3. Delete source deck
    await tx
      .delete(schema.flashcardDecks)
      .where(
        and(
          eq(schema.flashcardDecks.id, sourceDeckId),
          eq(schema.flashcardDecks.workspaceId, workspaceId),
        ),
      );

    // 4. Audit event
    await recordAudit(tx as unknown as FullDb, {
      workspaceId,
      actorUserId,
      action: 'flashcard.deck_merged',
      targetType: 'flashcard_deck',
      targetId: sourceDeckId,
      metadata: {
        sourceDeckId,
        targetDeckId,
        cardsMoved: movedCards.length,
        childrenReparented: movedChildren.length,
      },
    });

    return { cardsMoved: movedCards.length, childrenReparented: movedChildren.length };
  });
}

/**
 * Delete a deck with one of two dispositions:
 *
 * 'moveToDefault': re-point this deck's cards to the Default deck
 *   (ensureDefaultDeck), reparent its child decks to NULL (root — chosen over
 *   moving to Default to avoid accidentally nesting decks that weren't in
 *   Default's subtree). Delete the deck.
 *
 * 'deleteCards': hard-delete this deck's cards AND their flashcardReviews
 *   rows (via FK cascade), then delete the deck.
 *
 * In both cases an audit event (flashcard.deck_deleted) is emitted.
 *
 * Guards:
 *   "Cannot delete the Default deck"   → 400
 *   "Deck not found"                   → 404
 */
export async function deleteDeck(
  db: FullDb,
  workspaceId: string,
  deckId: string,
  disposition: 'moveToDefault' | 'deleteCards',
  actorUserId: string | null = null,
): Promise<{ affectedCards: number }> {
  return db.transaction(async (tx) => {
    const [deck] = await tx
      .select()
      .from(schema.flashcardDecks)
      .where(
        and(
          eq(schema.flashcardDecks.id, deckId),
          eq(schema.flashcardDecks.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!deck) throw new Error('Deck not found');
    if (deck.name === DEFAULT_DECK_NAME) throw new Error('Cannot delete the Default deck');

    let affectedCards = 0;

    if (disposition === 'moveToDefault') {
      // Ensure Default deck exists (creates it if absent)
      const defaultDeck = await ensureDefaultDeck(tx, workspaceId);
      // Re-point cards → Default
      const moved = await tx
        .update(schema.flashcardCards)
        .set({ deckId: defaultDeck.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.flashcardCards.deckId, deckId),
            eq(schema.flashcardCards.workspaceId, workspaceId),
          ),
        )
        .returning({ id: schema.flashcardCards.id });
      affectedCards = moved.length;

      // Reparent child decks to NULL (root) — keeps hierarchy meaningful
      await tx
        .update(schema.flashcardDecks)
        .set({ parentDeckId: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.flashcardDecks.parentDeckId, deckId),
            eq(schema.flashcardDecks.workspaceId, workspaceId),
          ),
        );
    } else {
      // 'deleteCards': hard-delete cards (reviews cascade via FK)
      // First get the card ids scoped to workspace
      const cardIds = await tx
        .select({ id: schema.flashcardCards.id })
        .from(schema.flashcardCards)
        .where(
          and(
            eq(schema.flashcardCards.deckId, deckId),
            eq(schema.flashcardCards.workspaceId, workspaceId),
          ),
        );
      if (cardIds.length > 0) {
        // Explicitly delete reviews first (though cascade should handle it),
        // then delete cards.
        await tx.delete(schema.flashcardReviews).where(
          inArray(
            schema.flashcardReviews.cardId,
            cardIds.map((c) => c.id),
          ),
        );
        await tx.delete(schema.flashcardCards).where(
          inArray(
            schema.flashcardCards.id,
            cardIds.map((c) => c.id),
          ),
        );
        affectedCards = cardIds.length;
      }

      // Reparent child decks to NULL (root)
      await tx
        .update(schema.flashcardDecks)
        .set({ parentDeckId: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.flashcardDecks.parentDeckId, deckId),
            eq(schema.flashcardDecks.workspaceId, workspaceId),
          ),
        );
    }

    // Delete the deck
    await tx
      .delete(schema.flashcardDecks)
      .where(
        and(
          eq(schema.flashcardDecks.id, deckId),
          eq(schema.flashcardDecks.workspaceId, workspaceId),
        ),
      );

    // Audit event
    await recordAudit(tx as unknown as FullDb, {
      workspaceId,
      actorUserId,
      action: 'flashcard.deck_deleted',
      targetType: 'flashcard_deck',
      targetId: deckId,
      metadata: {
        deckId,
        deckName: deck.name,
        disposition,
        affectedCards,
      },
    });

    return { affectedCards };
  });
}
