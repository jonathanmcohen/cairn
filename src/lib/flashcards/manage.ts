import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * Flashcard management queries + mutations (v0.10.2 F1, data layer / Task A).
 *
 * The manage table lists every card in a workspace (NOT per-user-due) with its
 * deck, tags, source page, and the requesting user's SM-2 state, plus rich
 * filtering. All helpers are db/tx-injected and pure (business logic only);
 * the API routes that wrap them are Task B.
 *
 * "State" is derived per (card, user) from the review row + the card flags:
 *   - suspended : card.suspended_at IS NOT NULL  (takes precedence)
 *   - new       : no review row, OR reps = 0
 *   - learning  : reps > 0 AND interval < 21 days
 *   - review    : reps > 0 AND interval >= 21 days
 */

type Db = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'update' | 'delete'>;

export type CardState = 'new' | 'learning' | 'review' | 'suspended';

const LEARNING_GRADUATION_INTERVAL = 21; // days; interval >= this is "review"

export type ManageFilters = {
  deckId?: string;
  tag?: string;
  state?: CardState;
  /** Cards due at or before this instant (for the requesting user). */
  dueBefore?: Date;
  /** Cards due at or after this instant. */
  dueAfter?: Date;
  /** true → only cards whose source page still exists; false → only orphaned. */
  sourcePageExists?: boolean;
  /** Case-insensitive substring match on front OR back. */
  search?: string;
};

export type ManageCard = {
  id: string;
  front: string;
  back: string;
  deckId: string | null;
  deckName: string | null;
  tags: string[];
  pageId: string | null;
  pageTitle: string | null;
  sourceOrphanedAt: Date | null;
  suspendedAt: Date | null;
  ease: number;
  interval: number;
  reps: number;
  dueAt: Date | null;
  lastReviewedAt: Date | null;
  lastGrade: number | null;
  state: CardState;
};

function deriveState(input: {
  suspendedAt: Date | null;
  reps: number | null;
  interval: number | null;
}): CardState {
  if (input.suspendedAt) return 'suspended';
  const reps = input.reps ?? 0;
  if (reps === 0) return 'new';
  return (input.interval ?? 0) >= LEARNING_GRADUATION_INTERVAL ? 'review' : 'learning';
}

/**
 * List cards in a workspace with the requesting user's review state, filtered.
 * The `userId` is whose SM-2 row is LEFT-JOINed (state/due/ease/interval/reps).
 */
export async function listCards(
  db: Db,
  workspaceId: string,
  userId: string,
  filters: ManageFilters = {},
): Promise<ManageCard[]> {
  const conds = [eq(schema.flashcardCards.workspaceId, workspaceId)];
  if (filters.deckId) conds.push(eq(schema.flashcardCards.deckId, filters.deckId));
  if (filters.tag) conds.push(arrayContains(schema.flashcardCards.tags, [filters.tag]));
  if (filters.sourcePageExists === true) conds.push(isNull(schema.flashcardCards.sourceOrphanedAt));
  if (filters.sourcePageExists === false)
    conds.push(sql`${schema.flashcardCards.sourceOrphanedAt} IS NOT NULL`);
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    const s = or(
      ilike(schema.flashcardCards.front, pattern),
      ilike(schema.flashcardCards.back, pattern),
    );
    if (s) conds.push(s);
  }
  if (filters.dueBefore) conds.push(lte(schema.flashcardReviews.dueAt, filters.dueBefore));
  if (filters.dueAfter) conds.push(gte(schema.flashcardReviews.dueAt, filters.dueAfter));

  // State filter compiled to SQL so it works at the DB boundary. Each branch
  // pushes its predicates individually — every element of `conds` is AND'd in
  // the final `.where(and(...conds))`, so there's no need to nest an `and()`.
  if (filters.state === 'suspended') {
    conds.push(sql`${schema.flashcardCards.suspendedAt} IS NOT NULL`);
  } else if (filters.state === 'new') {
    conds.push(isNull(schema.flashcardCards.suspendedAt));
    conds.push(
      sql`(${schema.flashcardReviews.reps} IS NULL OR ${schema.flashcardReviews.reps} = 0)`,
    );
  } else if (filters.state === 'learning') {
    conds.push(isNull(schema.flashcardCards.suspendedAt));
    conds.push(gte(schema.flashcardReviews.reps, 1));
    conds.push(lte(schema.flashcardReviews.interval, LEARNING_GRADUATION_INTERVAL - 1));
  } else if (filters.state === 'review') {
    conds.push(isNull(schema.flashcardCards.suspendedAt));
    conds.push(gte(schema.flashcardReviews.reps, 1));
    conds.push(gte(schema.flashcardReviews.interval, LEARNING_GRADUATION_INTERVAL));
  }

  const rows = await db
    .select({
      id: schema.flashcardCards.id,
      front: schema.flashcardCards.front,
      back: schema.flashcardCards.back,
      deckId: schema.flashcardCards.deckId,
      deckName: schema.flashcardDecks.name,
      tags: schema.flashcardCards.tags,
      pageId: schema.flashcardCards.pageId,
      pageTitle: schema.pages.title,
      sourceOrphanedAt: schema.flashcardCards.sourceOrphanedAt,
      suspendedAt: schema.flashcardCards.suspendedAt,
      ease: schema.flashcardReviews.ease,
      interval: schema.flashcardReviews.interval,
      reps: schema.flashcardReviews.reps,
      dueAt: schema.flashcardReviews.dueAt,
      lastReviewedAt: schema.flashcardReviews.lastReviewedAt,
      lastGrade: schema.flashcardReviews.lastGrade,
    })
    .from(schema.flashcardCards)
    .leftJoin(schema.flashcardDecks, eq(schema.flashcardDecks.id, schema.flashcardCards.deckId))
    .leftJoin(schema.pages, eq(schema.pages.id, schema.flashcardCards.pageId))
    .leftJoin(
      schema.flashcardReviews,
      and(
        eq(schema.flashcardReviews.cardId, schema.flashcardCards.id),
        eq(schema.flashcardReviews.userId, userId),
      ),
    )
    .where(and(...conds))
    .orderBy(desc(schema.flashcardCards.updatedAt), asc(schema.flashcardCards.id));

  return rows.map((r) => ({
    id: r.id,
    front: r.front,
    back: r.back,
    deckId: r.deckId,
    deckName: r.deckName,
    tags: r.tags,
    pageId: r.pageId,
    pageTitle: r.pageTitle,
    sourceOrphanedAt: r.sourceOrphanedAt,
    suspendedAt: r.suspendedAt,
    ease: r.ease ?? 2.5,
    interval: r.interval ?? 0,
    reps: r.reps ?? 0,
    dueAt: r.dueAt,
    lastReviewedAt: r.lastReviewedAt,
    lastGrade: r.lastGrade,
    state: deriveState({ suspendedAt: r.suspendedAt, reps: r.reps, interval: r.interval }),
  }));
}

// ---------------------------------------------------------------------------
// Mutations. All are workspace-scoped (the `workspaceId` predicate guards
// against cross-workspace id injection) and accept id arrays for bulk use.
// ---------------------------------------------------------------------------

function scoped(workspaceId: string, cardIds: string[]) {
  return and(
    eq(schema.flashcardCards.workspaceId, workspaceId),
    inArray(schema.flashcardCards.id, cardIds),
  );
}

/** Move card(s) to a deck (or detach, with `deckId = null`). */
export async function moveToDeck(
  db: Db,
  workspaceId: string,
  cardIds: string[],
  deckId: string | null,
): Promise<number> {
  if (cardIds.length === 0) return 0;
  const rows = await db
    .update(schema.flashcardCards)
    .set({ deckId, updatedAt: new Date() })
    .where(scoped(workspaceId, cardIds))
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}

/** Add tag(s) to card(s) (de-duped, order-preserving union). */
export async function addTags(
  db: Db,
  workspaceId: string,
  cardIds: string[],
  tags: string[],
): Promise<number> {
  const clean = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))];
  if (cardIds.length === 0 || clean.length === 0) return 0;
  // Postgres array union that preserves existing order then appends new tags:
  //   tags || (array of new tags not already present)
  const additions = sql`(
    SELECT COALESCE(array_agg(t), '{}') FROM unnest(${sql.raw(
      `ARRAY[${clean.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]::text[]`,
    )}) AS t
    WHERE NOT (${schema.flashcardCards.tags} @> ARRAY[t])
  )`;
  const rows = await db
    .update(schema.flashcardCards)
    .set({ tags: sql`${schema.flashcardCards.tags} || ${additions}`, updatedAt: new Date() })
    .where(scoped(workspaceId, cardIds))
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}

/** Remove tag(s) from card(s). */
export async function removeTags(
  db: Db,
  workspaceId: string,
  cardIds: string[],
  tags: string[],
): Promise<number> {
  const clean = tags.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cardIds.length === 0 || clean.length === 0) return 0;
  const removals = sql.raw(
    `ARRAY[${clean.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]::text[]`,
  );
  const rows = await db
    .update(schema.flashcardCards)
    .set({
      tags: sql`(
        SELECT COALESCE(array_agg(t), '{}') FROM unnest(${schema.flashcardCards.tags}) AS t
        WHERE NOT (${removals} @> ARRAY[t])
      )`,
      updatedAt: new Date(),
    })
    .where(scoped(workspaceId, cardIds))
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}

/** Suspend card(s): stamp `suspended_at` (idempotent — keeps first stamp). */
export async function suspendCards(
  db: Db,
  workspaceId: string,
  cardIds: string[],
  now: Date = new Date(),
): Promise<number> {
  if (cardIds.length === 0) return 0;
  const rows = await db
    .update(schema.flashcardCards)
    .set({ suspendedAt: now, updatedAt: now })
    .where(and(scoped(workspaceId, cardIds), isNull(schema.flashcardCards.suspendedAt)))
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}

/** Unsuspend card(s): clear `suspended_at`. */
export async function unsuspendCards(
  db: Db,
  workspaceId: string,
  cardIds: string[],
  now: Date = new Date(),
): Promise<number> {
  if (cardIds.length === 0) return 0;
  const rows = await db
    .update(schema.flashcardCards)
    .set({ suspendedAt: null, updatedAt: now })
    .where(scoped(workspaceId, cardIds))
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}

/**
 * Reset SM-2 state for the given (card, user): ease 2.5, interval 0, reps 0,
 * due now. Only resets existing review rows; cards the user has never reviewed
 * are already in the reset state (no row = brand new). Workspace-scoped via a
 * subquery so a caller can't reset a card outside their workspace.
 */
export async function resetSm2(
  db: Db,
  workspaceId: string,
  userId: string,
  cardIds: string[],
  now: Date = new Date(),
): Promise<number> {
  if (cardIds.length === 0) return 0;
  const scopedCardIds = await db
    .select({ id: schema.flashcardCards.id })
    .from(schema.flashcardCards)
    .where(scoped(workspaceId, cardIds));
  const ids = scopedCardIds.map((r) => r.id);
  if (ids.length === 0) return 0;
  const rows = await db
    .update(schema.flashcardReviews)
    .set({ ease: 2.5, interval: 0, reps: 0, dueAt: now, updatedAt: now })
    .where(
      and(eq(schema.flashcardReviews.userId, userId), inArray(schema.flashcardReviews.cardId, ids)),
    )
    .returning({ cardId: schema.flashcardReviews.cardId });
  return rows.length;
}

/** Permanently delete card(s) (review rows cascade). Workspace-scoped. */
export async function deleteCards(db: Db, workspaceId: string, cardIds: string[]): Promise<number> {
  if (cardIds.length === 0) return 0;
  const rows = await db
    .delete(schema.flashcardCards)
    .where(scoped(workspaceId, cardIds))
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}

/**
 * v0.10.2 F1 Task B — full row snapshot for the undo-delete flow.
 *
 * The manage view's delete is hard (the row + its cascaded `flashcard_reviews`
 * are gone), but the UI offers a 10s undo. To restore the card AND every user's
 * SM-2 history, the route snapshots both tables BEFORE the delete and hands the
 * snapshot back to {@link restoreCards} if the user clicks undo. Workspace-
 * scoped so a caller can't snapshot a card outside their workspace.
 */
export type DeletedCardSnapshot = {
  card: typeof schema.flashcardCards.$inferSelect;
  reviews: (typeof schema.flashcardReviews.$inferSelect)[];
};

/** Snapshot card rows + their review rows for the undo-delete buffer. */
export async function snapshotCards(
  db: Db,
  workspaceId: string,
  cardIds: string[],
): Promise<DeletedCardSnapshot[]> {
  if (cardIds.length === 0) return [];
  const cards = await db.select().from(schema.flashcardCards).where(scoped(workspaceId, cardIds));
  if (cards.length === 0) return [];
  const ids = cards.map((c) => c.id);
  const reviews = await db
    .select()
    .from(schema.flashcardReviews)
    .where(inArray(schema.flashcardReviews.cardId, ids));
  return cards.map((card) => ({
    card,
    reviews: reviews.filter((r) => r.cardId === card.id),
  }));
}

/**
 * Re-insert previously-deleted cards and their review rows (the undo path).
 * Idempotent-ish: `onConflictDoNothing` skips any row that already exists, so a
 * double-undo (or an undo of a card that was re-created) can't error. Returns
 * the number of card rows restored.
 */
export async function restoreCards(
  db: Pick<PostgresJsDatabase<typeof schema>, 'insert'>,
  snapshots: DeletedCardSnapshot[],
): Promise<number> {
  if (snapshots.length === 0) return 0;
  let restored = 0;
  for (const snap of snapshots) {
    const inserted = await db
      .insert(schema.flashcardCards)
      .values(snap.card)
      .onConflictDoNothing()
      .returning({ id: schema.flashcardCards.id });
    restored += inserted.length;
    if (snap.reviews.length > 0) {
      await db.insert(schema.flashcardReviews).values(snap.reviews).onConflictDoNothing();
    }
  }
  return restored;
}

/**
 * Reattach orphaned card(s) to a page within the workspace: set page_id +
 * clear the orphan flag. The caller validates the page belongs to the same
 * workspace; this re-checks the card scope.
 */
export async function reattachCards(
  db: Db,
  workspaceId: string,
  cardIds: string[],
  pageId: string,
  now: Date = new Date(),
): Promise<number> {
  if (cardIds.length === 0) return 0;
  const rows = await db
    .update(schema.flashcardCards)
    .set({ pageId, sourceOrphanedAt: null, updatedAt: now })
    .where(scoped(workspaceId, cardIds))
    .returning({ id: schema.flashcardCards.id });
  return rows.length;
}
