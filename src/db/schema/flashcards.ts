import {
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

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
 */
export const flashcardCards = pgTable(
  'flashcard_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    blockId: text('block_id').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    deckTag: text('deck_tag'),
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
