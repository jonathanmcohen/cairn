import { redirect } from 'next/navigation';
import { DecksClient } from '@/components/flashcards/decks-client';
import type { DeckCountDto, DeckTreeDto } from '@/components/flashcards/types';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { deckCounts, listDeckTree } from '@/lib/flashcards/decks';

export const dynamic = 'force-dynamic';

/**
 * /flashcards/decks (v0.10.2 F2 Task C) — the workspace's flashcard deck tree
 * with per-deck SM-2 bucket counts for the calling user. SSRs the initial deck
 * list + counts; the client component (`DecksClient`) drives rename / icon /
 * color / option edits, drag-to-reparent, and the lifecycle (move-all / merge /
 * delete) mutations against the F2-B decks API. Access: any workspace member
 * (matches the sibling manage + study routes).
 */
export default async function FlashcardsDecksPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');

  const db = getDb();
  const [decks, counts] = await Promise.all([
    listDeckTree(db, ctx.workspaceId),
    deckCounts(db, ctx.userId, ctx.workspaceId),
  ]);

  const initialDecks: DeckTreeDto[] = decks.map((d) => ({
    id: d.id,
    name: d.name,
    icon: d.icon,
    color: d.color,
    parentDeckId: d.parentDeckId,
    defaultNewPerDay: d.defaultNewPerDay,
    defaultReviewLimit: d.defaultReviewLimit,
    easeStart: d.easeStart,
  }));

  const initialCounts: DeckCountDto[] = counts.map((c) => ({
    deckId: c.deckId,
    new: c.new,
    learning: c.learning,
    review: c.review,
    mature: c.mature,
  }));

  return <DecksClient initialDecks={initialDecks} initialCounts={initialCounts} />;
}
