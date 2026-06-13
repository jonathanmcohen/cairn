import { redirect } from 'next/navigation';
import { FlashcardsOrphansClient } from '@/components/flashcards/orphans-client';
import type { OrphanCardDto } from '@/components/flashcards/types';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { listCards } from '@/lib/flashcards/manage';

export const dynamic = 'force-dynamic';

/**
 * /flashcards/orphans (v0.10.2 F1 Task C) — the orphaned-cards triage surface.
 * An orphaned card has lost its source (page permanently deleted, or its
 * `flashcard` block removed) but kept its review history; here the user resolves
 * each: reattach to a page, keep as a standalone card, or delete.
 *
 * Reuses `listCards` with the `sourcePageExists: false` filter (orphaned only),
 * which already LEFT-JOINs the deck name + the requesting user's SM-2 state — so
 * the orphan row carries deck/tags/when-orphaned/review-state without a bespoke
 * query. Access: any workspace member (matches study + manage).
 */
export default async function FlashcardsOrphansPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');

  const cards = await listCards(getDb(), ctx.workspaceId, ctx.userId, {
    sourcePageExists: false,
  });

  const orphans: OrphanCardDto[] = cards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    deckName: c.deckName,
    tags: c.tags,
    sourceOrphanedAt: c.sourceOrphanedAt?.toISOString() ?? null,
    state: c.state,
  }));

  return <FlashcardsOrphansClient initialOrphans={orphans} />;
}
