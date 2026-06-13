/**
 * Shared DTO types for the flashcards manage surface (v0.10.2 F1 Task B). The
 * server page + the API list route both serialize `ManageCard` (from
 * `src/lib/flashcards/manage.ts`) into this date-as-ISO-string shape for the
 * client.
 */

export type CardState = 'new' | 'learning' | 'review' | 'suspended';

export type ManageCardDto = {
  id: string;
  front: string;
  back: string;
  deckId: string | null;
  deckName: string | null;
  tags: string[];
  pageId: string | null;
  pageTitle: string | null;
  sourceOrphanedAt: string | null;
  suspendedAt: string | null;
  ease: number;
  interval: number;
  reps: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
  state: CardState;
};

export type DeckDto = { id: string; name: string };

/** Overview headline counts (v0.10.2 F1 Task C). */
export type OverviewCountsDto = {
  due: number;
  new: number;
  mature: number;
  total: number;
};

/** A recently-reviewed card on the overview page (date as ISO string). */
export type RecentReviewDto = {
  cardId: string;
  front: string;
  back: string;
  pageId: string | null;
  pageTitle: string | null;
  lastReviewedAt: string;
  lastGrade: number | null;
};

/** An orphaned card row for the orphans surface (v0.10.2 F1 Task C). */
export type OrphanCardDto = {
  id: string;
  front: string;
  back: string;
  deckName: string | null;
  tags: string[];
  sourceOrphanedAt: string | null;
  state: CardState;
};
