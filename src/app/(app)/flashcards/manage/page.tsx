import { redirect } from 'next/navigation';
import { FlashcardsManageClient } from '@/components/flashcards/manage-client';
import type { ManageCardDto } from '@/components/flashcards/types';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { listDecks } from '@/lib/flashcards/decks';
import { listCards } from '@/lib/flashcards/manage';

export const dynamic = 'force-dynamic';

/**
 * /flashcards/manage (v0.10.2 F1 Task B) — the workspace-wide flashcard manage
 * table for the calling user. SSRs the initial unfiltered list + the deck list;
 * the client component re-fetches `/api/flashcards/manage` as filters change and
 * drives the bulk/per-card mutations. Access: any workspace member (matches the
 * study route, which is gated by `requireWorkspace` only).
 */
export default async function FlashcardsManagePage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');

  const db = getDb();
  const [cards, decks] = await Promise.all([
    listCards(db, ctx.workspaceId, ctx.userId),
    listDecks(db, ctx.workspaceId),
  ]);

  const initialCards: ManageCardDto[] = cards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    deckId: c.deckId,
    deckName: c.deckName,
    tags: c.tags,
    pageId: c.pageId,
    pageTitle: c.pageTitle,
    sourceOrphanedAt: c.sourceOrphanedAt?.toISOString() ?? null,
    suspendedAt: c.suspendedAt?.toISOString() ?? null,
    ease: c.ease,
    interval: c.interval,
    reps: c.reps,
    dueAt: c.dueAt?.toISOString() ?? null,
    lastReviewedAt: c.lastReviewedAt?.toISOString() ?? null,
    state: c.state,
  }));

  const initialDecks = decks.map((d) => ({ id: d.id, name: d.name }));

  return <FlashcardsManageClient initialCards={initialCards} initialDecks={initialDecks} />;
}
