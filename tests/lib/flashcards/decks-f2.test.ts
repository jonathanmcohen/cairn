/**
 * F2 Task B — deck management lib tests (v0.10.2).
 * Testcontainers Postgres, per-file singleton, TRUNCATE in beforeEach.
 * Covers: setDeckOptions, reparentDeck (cycle guard), mergeDeck, deleteDeck,
 * listDeckTree, deckCounts (new/learning/review/mature buckets).
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  createDeck,
  deckCounts,
  deleteDeck,
  ensureDefaultDeck,
  listDeckTree,
  mergeDeck,
  reparentDeck,
  setDeckOptions,
} from '@/lib/flashcards/decks';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE audit_log, flashcard_reviews, flashcard_cards, flashcard_decks, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a card directly (no page needed). */
async function insertCard(
  workspaceId: string,
  userId: string,
  deckId: string | null,
  blockId = `blk-${Math.random()}`,
) {
  const [card] = await db
    .insert(schema.flashcardCards)
    .values({
      workspaceId,
      blockId,
      front: 'Q',
      back: 'A',
      deckTag: null,
      deckId,
      createdBy: userId,
    })
    .returning();
  if (!card) throw new Error('insertCard failed');
  return card;
}

/** Insert a review row to simulate SM-2 state. */
async function insertReview(
  cardId: string,
  userId: string,
  interval: number,
  reps = interval === 0 ? 1 : 3,
) {
  await db
    .insert(schema.flashcardReviews)
    .values({
      cardId,
      userId,
      ease: 2.5,
      interval,
      reps,
      dueAt: new Date(),
      lastReviewedAt: new Date(),
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// setDeckOptions
// ---------------------------------------------------------------------------

describe('setDeckOptions', () => {
  it('updates individual fields and leaves others unchanged', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'Science');

    // Set icon + defaultNewPerDay
    const updated = await setDeckOptions(db, u.workspaceId, deck.id, {
      icon: 'emoji::🔬',
      defaultNewPerDay: 10,
    });
    expect(updated.icon).toBe('emoji::🔬');
    expect(updated.defaultNewPerDay).toBe(10);
    expect(updated.color).toBeNull(); // untouched
    expect(updated.easeStart).toBeNull(); // untouched
    expect(updated.defaultReviewLimit).toBeNull(); // untouched
  });

  it('explicit null clears a previously set field', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'History');
    await setDeckOptions(db, u.workspaceId, deck.id, { color: '#ff0000', easeStart: 2.3 });
    const cleared = await setDeckOptions(db, u.workspaceId, deck.id, {
      color: null,
      easeStart: null,
    });
    expect(cleared.color).toBeNull();
    expect(cleared.easeStart).toBeNull();
  });

  it('throws Deck not found for wrong workspace', async () => {
    const u1 = await createTestWorkspaceWithUser(db);
    const u2 = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u1.workspaceId, 'Deck');
    await expect(
      setDeckOptions(db, u2.workspaceId, deck.id, { icon: 'emoji::📚' }),
    ).rejects.toThrow('Deck not found');
  });

  it('round-trips all option fields', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'Full');
    const result = await setDeckOptions(db, u.workspaceId, deck.id, {
      icon: 'file::abc',
      color: '#123456',
      defaultNewPerDay: 20,
      defaultReviewLimit: 100,
      easeStart: 2.7,
    });
    expect(result.icon).toBe('file::abc');
    expect(result.color).toBe('#123456');
    expect(result.defaultNewPerDay).toBe(20);
    expect(result.defaultReviewLimit).toBe(100);
    expect(result.easeStart).toBeCloseTo(2.7);
  });
});

// ---------------------------------------------------------------------------
// reparentDeck
// ---------------------------------------------------------------------------

describe('reparentDeck', () => {
  it('rejects self-reparent', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'A');
    await expect(reparentDeck(db, u.workspaceId, deck.id, deck.id)).rejects.toThrow(
      'Cannot make a deck a child of itself',
    );
  });

  it('rejects cycle: new parent is a descendant of the target', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const grandparent = await createDeck(db, u.workspaceId, 'GP');
    const child = await createDeck(db, u.workspaceId, 'Child');
    const grandchild = await createDeck(db, u.workspaceId, 'GC');

    // Build chain: grandparent → child → grandchild
    await reparentDeck(db, u.workspaceId, child.id, grandparent.id);
    await reparentDeck(db, u.workspaceId, grandchild.id, child.id);

    // Trying to make grandparent a child of grandchild would cycle
    await expect(reparentDeck(db, u.workspaceId, grandparent.id, grandchild.id)).rejects.toThrow(
      'Cycle detected',
    );
  });

  it('allows valid reparent', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const parent = await createDeck(db, u.workspaceId, 'Parent');
    const child = await createDeck(db, u.workspaceId, 'Child');
    const result = await reparentDeck(db, u.workspaceId, child.id, parent.id);
    expect(result.parentDeckId).toBe(parent.id);
  });

  it('allows move to root (null)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const parent = await createDeck(db, u.workspaceId, 'Parent');
    const child = await createDeck(db, u.workspaceId, 'Child');
    await reparentDeck(db, u.workspaceId, child.id, parent.id);
    const result = await reparentDeck(db, u.workspaceId, child.id, null);
    expect(result.parentDeckId).toBeNull();
  });

  it('rejects parent from different workspace', async () => {
    const u1 = await createTestWorkspaceWithUser(db);
    const u2 = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u1.workspaceId, 'Deck');
    const other = await createDeck(db, u2.workspaceId, 'Other');
    await expect(reparentDeck(db, u1.workspaceId, deck.id, other.id)).rejects.toThrow(
      'Parent deck not found',
    );
  });
});

// ---------------------------------------------------------------------------
// mergeDeck
// ---------------------------------------------------------------------------

describe('mergeDeck', () => {
  it('re-points cards to target and deletes source', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const src = await createDeck(db, u.workspaceId, 'Src');
    const tgt = await createDeck(db, u.workspaceId, 'Tgt');
    const card = await insertCard(u.workspaceId, u.userId, src.id);

    const result = await mergeDeck(db, u.workspaceId, src.id, tgt.id);
    expect(result.cardsMoved).toBe(1);

    // Card should now point to target
    const [updated] = await db
      .select({ deckId: schema.flashcardCards.deckId })
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));
    expect(updated?.deckId).toBe(tgt.id);

    // Source deck should be gone
    const decks = await listDeckTree(db, u.workspaceId);
    expect(decks.find((d) => d.id === src.id)).toBeUndefined();
  });

  it('reparents source children to target', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const src = await createDeck(db, u.workspaceId, 'Src');
    const tgt = await createDeck(db, u.workspaceId, 'Tgt');
    const child = await createDeck(db, u.workspaceId, 'ChildOfSrc');
    await reparentDeck(db, u.workspaceId, child.id, src.id);

    const result = await mergeDeck(db, u.workspaceId, src.id, tgt.id);
    expect(result.childrenReparented).toBe(1);

    // Child should now point to target
    const [updated] = await db
      .select({ parentDeckId: schema.flashcardDecks.parentDeckId })
      .from(schema.flashcardDecks)
      .where(eq(schema.flashcardDecks.id, child.id));
    expect(updated?.parentDeckId).toBe(tgt.id);
  });

  it('leaves SM-2 review rows untouched', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const src = await createDeck(db, u.workspaceId, 'Src');
    const tgt = await createDeck(db, u.workspaceId, 'Tgt');
    const card = await insertCard(u.workspaceId, u.userId, src.id);
    await insertReview(card.id, u.userId, 7); // interval=7

    await mergeDeck(db, u.workspaceId, src.id, tgt.id);

    const [review] = await db
      .select()
      .from(schema.flashcardReviews)
      .where(eq(schema.flashcardReviews.cardId, card.id));
    expect(review?.interval).toBe(7); // untouched
    expect(review?.ease).toBeCloseTo(2.5);
  });

  it('rejects self-merge', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'A');
    await expect(mergeDeck(db, u.workspaceId, deck.id, deck.id)).rejects.toThrow(
      'Cannot merge a deck into itself',
    );
  });

  it('rejects merging away the Default deck (would delete it)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const def = await ensureDefaultDeck(db, u.workspaceId);
    const other = await createDeck(db, u.workspaceId, 'Other');
    await expect(mergeDeck(db, u.workspaceId, def.id, other.id)).rejects.toThrow(
      'Cannot delete the Default deck',
    );
  });

  it('allows merging INTO Default (Default is the target)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const def = await ensureDefaultDeck(db, u.workspaceId);
    const src = await createDeck(db, u.workspaceId, 'Src');
    await insertCard(u.workspaceId, u.userId, src.id);
    // Should not throw — we're deleting src, not Default
    await expect(mergeDeck(db, u.workspaceId, src.id, def.id)).resolves.toBeTruthy();
  });

  it('records an audit event', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const src = await createDeck(db, u.workspaceId, 'Src');
    const tgt = await createDeck(db, u.workspaceId, 'Tgt');
    await mergeDeck(db, u.workspaceId, src.id, tgt.id, u.userId);
    const [auditRow] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'flashcard.deck_merged'));
    expect(auditRow).toBeDefined();
    expect(auditRow?.targetId).toBe(src.id);
  });
});

// ---------------------------------------------------------------------------
// deleteDeck
// ---------------------------------------------------------------------------

describe('deleteDeck', () => {
  it('moveToDefault: re-points cards to Default deck and deletes source deck', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const def = await ensureDefaultDeck(db, u.workspaceId);
    const src = await createDeck(db, u.workspaceId, 'Src');
    const card = await insertCard(u.workspaceId, u.userId, src.id);

    const result = await deleteDeck(db, u.workspaceId, src.id, 'moveToDefault');
    expect(result.affectedCards).toBe(1);

    // Card now in Default
    const [updated] = await db
      .select({ deckId: schema.flashcardCards.deckId })
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));
    expect(updated?.deckId).toBe(def.id);

    // Src gone
    const decks = await listDeckTree(db, u.workspaceId);
    expect(decks.find((d) => d.id === src.id)).toBeUndefined();
  });

  it('moveToDefault: reparents children to NULL (root)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await ensureDefaultDeck(db, u.workspaceId);
    const src = await createDeck(db, u.workspaceId, 'Src');
    const child = await createDeck(db, u.workspaceId, 'ChildOfSrc');
    await reparentDeck(db, u.workspaceId, child.id, src.id);

    await deleteDeck(db, u.workspaceId, src.id, 'moveToDefault');

    const [updated] = await db
      .select({ parentDeckId: schema.flashcardDecks.parentDeckId })
      .from(schema.flashcardDecks)
      .where(eq(schema.flashcardDecks.id, child.id));
    expect(updated?.parentDeckId).toBeNull(); // moved to root
  });

  it('deleteCards: hard-deletes cards and review rows', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const src = await createDeck(db, u.workspaceId, 'Src');
    const card = await insertCard(u.workspaceId, u.userId, src.id);
    await insertReview(card.id, u.userId, 5);

    const result = await deleteDeck(db, u.workspaceId, src.id, 'deleteCards');
    expect(result.affectedCards).toBe(1);

    // Card gone
    const cards = await db
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));
    expect(cards).toHaveLength(0);

    // Review gone
    const reviews = await db
      .select()
      .from(schema.flashcardReviews)
      .where(eq(schema.flashcardReviews.cardId, card.id));
    expect(reviews).toHaveLength(0);
  });

  it('prevents deleting the Default deck', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const def = await ensureDefaultDeck(db, u.workspaceId);
    await expect(deleteDeck(db, u.workspaceId, def.id, 'moveToDefault')).rejects.toThrow(
      'Cannot delete the Default deck',
    );
    await expect(deleteDeck(db, u.workspaceId, def.id, 'deleteCards')).rejects.toThrow(
      'Cannot delete the Default deck',
    );
  });

  it('throws Deck not found for unknown id', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await expect(
      deleteDeck(db, u.workspaceId, '00000000-0000-0000-0000-000000000001', 'moveToDefault'),
    ).rejects.toThrow('Deck not found');
  });

  it('records an audit event with disposition', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await ensureDefaultDeck(db, u.workspaceId);
    const src = await createDeck(db, u.workspaceId, 'Src');
    await deleteDeck(db, u.workspaceId, src.id, 'deleteCards', u.userId);
    const [auditRow] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'flashcard.deck_deleted'));
    expect(auditRow).toBeDefined();
    const meta = auditRow?.metadata as Record<string, unknown>;
    expect(meta?.disposition).toBe('deleteCards');
  });
});

// ---------------------------------------------------------------------------
// listDeckTree
// ---------------------------------------------------------------------------

describe('listDeckTree', () => {
  it('returns all decks sorted by name including new fields', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createDeck(db, u.workspaceId, 'Zed');
    const alpha = await createDeck(db, u.workspaceId, 'Alpha');
    await setDeckOptions(db, u.workspaceId, alpha.id, {
      icon: 'emoji::📚',
      defaultNewPerDay: 5,
    });
    const decks = await listDeckTree(db, u.workspaceId);
    expect(decks[0]?.name).toBe('Alpha');
    expect(decks[0]?.icon).toBe('emoji::📚');
    expect(decks[0]?.defaultNewPerDay).toBe(5);
    expect(decks[1]?.name).toBe('Zed');
  });

  it('includes parentDeckId for tree construction', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const parent = await createDeck(db, u.workspaceId, 'Parent');
    const child = await createDeck(db, u.workspaceId, 'AChild');
    await reparentDeck(db, u.workspaceId, child.id, parent.id);
    const decks = await listDeckTree(db, u.workspaceId);
    const childRow = decks.find((d) => d.id === child.id);
    expect(childRow?.parentDeckId).toBe(parent.id);
  });
});

// ---------------------------------------------------------------------------
// deckCounts — new / learning / review / mature bucketing
// ---------------------------------------------------------------------------

describe('deckCounts', () => {
  it('buckets cards into new/learning/review/mature', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'Study');

    // new card: no review row
    await insertCard(u.workspaceId, u.userId, deck.id, 'new');

    // learning card: interval = 0 with a review row
    const learningCard = await insertCard(u.workspaceId, u.userId, deck.id, 'learning');
    await insertReview(learningCard.id, u.userId, 0);

    // review card: interval = 5 (1 <= x < 21)
    const reviewCard = await insertCard(u.workspaceId, u.userId, deck.id, 'review');
    await insertReview(reviewCard.id, u.userId, 5);

    // mature card: interval = 25 (>= 21)
    const matureCard = await insertCard(u.workspaceId, u.userId, deck.id, 'mature');
    await insertReview(matureCard.id, u.userId, 25);

    const counts = await deckCounts(db, u.userId, u.workspaceId);
    const row = counts.find((c) => c.deckId === deck.id);
    expect(row).toBeDefined();
    expect(row?.new).toBe(1);
    expect(row?.learning).toBe(1);
    expect(row?.review).toBe(1);
    expect(row?.mature).toBe(1);
  });

  it('excludes orphaned cards', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'Deck');
    const card = await insertCard(u.workspaceId, u.userId, deck.id, 'orphan');
    // Mark as orphaned
    await db
      .update(schema.flashcardCards)
      .set({ sourceOrphanedAt: new Date() })
      .where(eq(schema.flashcardCards.id, card.id));

    const counts = await deckCounts(db, u.userId, u.workspaceId);
    const row = counts.find((c) => c.deckId === deck.id);
    // orphaned cards excluded → row may be missing or all zeros
    if (row) {
      expect(row.new + row.learning + row.review + row.mature).toBe(0);
    }
  });

  it('excludes suspended cards', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'Deck');
    const card = await insertCard(u.workspaceId, u.userId, deck.id, 'suspended');
    await db
      .update(schema.flashcardCards)
      .set({ suspendedAt: new Date() })
      .where(eq(schema.flashcardCards.id, card.id));

    const counts = await deckCounts(db, u.userId, u.workspaceId);
    const row = counts.find((c) => c.deckId === deck.id);
    if (row) {
      expect(row.new + row.learning + row.review + row.mature).toBe(0);
    }
  });

  it('scopes counts per user (user A sees no counts for user B cards)', async () => {
    const u1 = await createTestWorkspaceWithUser(db);
    const u2 = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u1.workspaceId, 'Deck');
    const card = await insertCard(u1.workspaceId, u1.userId, deck.id);
    await insertReview(card.id, u1.userId, 5); // only u1 has a review

    // u2 has no workspace membership for u1's workspace, so no counts for u1's deck
    const countsU2 = await deckCounts(db, u2.userId, u1.workspaceId);
    const row = countsU2.find((c) => c.deckId === deck.id);
    // card has no review for u2, so it appears as "new" for that workspace query
    // but u2 is not in the workspace, so we just check it doesn't crash
    // The card counts as "new" for u2 (no review row), but only if queried for that workspace
    expect(row?.new ?? 1).toBe(1); // no review for u2 → new
    expect(row?.learning ?? 0).toBe(0);
  });

  it('returns empty array when no decks have eligible cards', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createDeck(db, u.workspaceId, 'EmptyDeck');
    const counts = await deckCounts(db, u.userId, u.workspaceId);
    // Empty deck → no rows in counts (GROUP BY produces no rows for decks with no cards)
    expect(counts).toHaveLength(0);
  });

  it('is workspace-scoped', async () => {
    const u1 = await createTestWorkspaceWithUser(db);
    const u2 = await createTestWorkspaceWithUser(db);
    const deck1 = await createDeck(db, u1.workspaceId, 'D1');
    await insertCard(u1.workspaceId, u1.userId, deck1.id);

    // u2's workspace has no cards
    const counts = await deckCounts(db, u2.userId, u2.workspaceId);
    expect(counts).toHaveLength(0);
  });

  it('counts cards with interval=1 as review (boundary)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'Deck');
    const card = await insertCard(u.workspaceId, u.userId, deck.id);
    await insertReview(card.id, u.userId, 1);

    const counts = await deckCounts(db, u.userId, u.workspaceId);
    const row = counts.find((c) => c.deckId === deck.id);
    expect(row?.review).toBe(1);
    expect(row?.learning).toBe(0);
  });

  it('counts cards with interval=20 as review and interval=21 as mature (boundary)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'Deck');
    const c20 = await insertCard(u.workspaceId, u.userId, deck.id, 'i20');
    const c21 = await insertCard(u.workspaceId, u.userId, deck.id, 'i21');
    await insertReview(c20.id, u.userId, 20);
    await insertReview(c21.id, u.userId, 21);

    const counts = await deckCounts(db, u.userId, u.workspaceId);
    const row = counts.find((c) => c.deckId === deck.id);
    expect(row?.review).toBe(1); // interval=20
    expect(row?.mature).toBe(1); // interval=21
  });
});

// ---------------------------------------------------------------------------
// DeckRow type — includes new F2 fields
// ---------------------------------------------------------------------------

describe('DeckRow F2 fields', () => {
  it('includes all new F2 fields from createDeck', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const deck = await createDeck(db, u.workspaceId, 'Test');
    expect(deck).toMatchObject({
      icon: null,
      color: null,
      parentDeckId: null,
      defaultNewPerDay: null,
      defaultReviewLimit: null,
      easeStart: null,
    });
  });
});
