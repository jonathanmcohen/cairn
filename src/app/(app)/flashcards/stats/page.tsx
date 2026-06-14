import { redirect } from 'next/navigation';
import { FlashcardsStatsClient } from '@/components/flashcards/stats-client';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { getFlashcardStats } from '@/lib/flashcards/stats';

export const dynamic = 'force-dynamic';

/**
 * /flashcards/stats — flashcard statistics surface (v0.10.2 F3 Task B).
 *
 * Server-renders all stat panels by calling `getFlashcardStats` directly
 * (no round-trip through the API route), then hydrates the client component.
 * Access: any workspace member (matches the study/manage routes).
 */
export default async function FlashcardsStatsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');

  const stats = await getFlashcardStats(getDb(), {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });

  return <FlashcardsStatsClient stats={stats} />;
}
