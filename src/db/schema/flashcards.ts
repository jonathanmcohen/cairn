import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * Named decks (v0.10.2 F1). One row per (workspace, name). A "Default" deck is
 * seeded per workspace by migration 0077; cards reference a deck via
 * `flashcard_cards.deck_id` (ON DELETE SET NULL). The legacy free-text
 * `deck_tag` column is kept for read-compat but is deprecated in favor of
 * `deck_id`.
 */
export const flashcardDecks = pgTable(
  'flashcard_decks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // v0.10.2 F2 — hierarchy + per-deck schedule overrides.
    // NULL on all fields means "inherit workspace default".
    /** Prefix-encoded icon: "emoji::…" or "file::…" (mirrors pages.icon). */
    icon: text('icon'),
    /** Color label for the deck tile. */
    color: text('color'),
    /** Self-FK for nested deck tree. ON DELETE SET NULL flattens orphaned children. */
    parentDeckId: uuid('parent_deck_id').references((): AnyPgColumn => flashcardDecks.id, {
      onDelete: 'set null',
    }),
    /** Per-deck cap on new cards introduced per day. */
    defaultNewPerDay: integer('default_new_per_day'),
    /** Per-deck cap on cards reviewed per day. */
    defaultReviewLimit: integer('default_review_limit'),
    /** Initial SM-2 ease factor for new cards in this deck. */
    easeStart: real('ease_start'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceNameUnique: unique('flashcard_decks_workspace_id_name_unique').on(
      t.workspaceId,
      t.name,
    ),
    parentDeckIdx: index('flashcard_decks_parent_deck_id_idx').on(t.parentDeckId),
  }),
);

/**
 * Flashcard blocks (v0.9.0 G3 P19). One row per `flashcard` TipTap node, keyed
 * by `(page_id, block_id)` so the editor's reconcile-on-save loop can find an
 * existing card by its stable client-generated block id.
 *
 * `workspace_id` is denormalized from the page so the daily due-notif cron can
 * filter by workspace (a future enhancement) and so per-workspace teardown
 * cascades from a single FK rather than chasing through `pages`. The page-FK
 * still cascades on delete.
 *
 * `front`/`back` carry the rendered text only. The page's TipTap JSON remains
 * the source of truth; this table is purely a join target for the SM-2
 * scheduler and the due-queue UI.
 *
 * v0.10.2 F1: `page_id` is now NULLABLE and its FK is ON DELETE SET NULL —
 * permanently deleting a page orphans its cards (sets `source_orphaned_at`)
 * rather than cascade-deleting them, so per-user review history survives.
 * `deck_id` (ON DELETE SET NULL) supersedes the free-text `deck_tag`. `tags`
 * and `suspended_at` back the manage view's filtering/suspension.
 */
export const flashcardCards = pgTable(
  'flashcard_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    blockId: text('block_id').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    // Deprecated free-text deck label, kept for read-compat. Use `deckId`.
    deckTag: text('deck_tag'),
    deckId: uuid('deck_id').references(() => flashcardDecks.id, { onDelete: 'set null' }),
    sourceOrphanedAt: timestamp('source_orphaned_at', { withTimezone: true }),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pageBlockIdx: index('flashcard_cards_page_block_idx').on(t.pageId, t.blockId),
  }),
);

/**
 * Per-user SM-2 scheduling state. Composite primary key `(card_id, user_id)`
 * makes one row per (card, user) — every workspace member has their own
 * schedule for the same card. Cards with no review row yet are considered
 * "brand new" and immediately due (handled at the query layer via LEFT JOIN).
 */
export const flashcardReviews = pgTable(
  'flashcard_reviews',
  {
    cardId: uuid('card_id')
      .notNull()
      .references(() => flashcardCards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ease: real('ease').notNull().default(2.5),
    interval: integer('interval').notNull().default(0),
    // Total successful repetitions recorded for this (card, user) pair. Bumped
    // on every grade in the grade route; the manage view surfaces it.
    reps: integer('reps').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    lastGrade: integer('last_grade'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.cardId, t.userId] }),
    dueIdx: index('flashcard_reviews_due_idx').on(t.userId, t.dueAt),
  }),
);

export type FlashcardCard = typeof flashcardCards.$inferSelect;
export type NewFlashcardCard = typeof flashcardCards.$inferInsert;
export type FlashcardReview = typeof flashcardReviews.$inferSelect;
export type NewFlashcardReview = typeof flashcardReviews.$inferInsert;
export type FlashcardDeck = typeof flashcardDecks.$inferSelect;
export type NewFlashcardDeck = typeof flashcardDecks.$inferInsert;
