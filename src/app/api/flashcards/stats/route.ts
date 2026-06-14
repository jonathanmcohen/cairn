import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { getFlashcardStats } from '@/lib/flashcards/stats';

export const runtime = 'nodejs';

/**
 * GET /api/flashcards/stats — flashcard statistics for the calling user's
 * active workspace (v0.10.2 F3 Task B). Includes daily reviews (30d), rolling
 * retention (30d), maturity distribution, GitHub-style heatmap (365d),
 * per-deck performance, and a 7-day due-date forecast.
 *
 * Auth: any workspace member. Fail-closed on auth error.
 */
export async function GET(): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const stats = await getFlashcardStats(getDb(), {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
