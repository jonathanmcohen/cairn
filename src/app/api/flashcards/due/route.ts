import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { listDueForUser } from '@/lib/flashcards/due-queue';

export const runtime = 'nodejs';

/**
 * GET /api/flashcards/due[?deck=<deckId>] — the active workspace's due-queue for
 * the calling user. Workspace-scoped: only cards in the user's active
 * workspace count toward the queue.
 *
 * v0.10.2 F2 — `?deck=` now carries a first-class `deckId` (was the legacy
 * `deckTag`). The value is only applied when it parses as a uuid: a
 * non-uuid/garbage deck param yields an empty queue rather than a 500 (an
 * `eq(deck_id, 'garbage')` would fail Postgres' uuid cast). A well-formed but
 * unknown deck id simply matches no cards → empty queue.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const url = new URL(req.url);
    const deck = url.searchParams.get('deck');
    const deckId = deck && z.uuid().safeParse(deck).success ? deck : null;
    // A garbage (non-uuid) ?deck= must not match any card; force an empty queue
    // without round-tripping a failing uuid comparison to Postgres.
    if (deck && !deckId) {
      return NextResponse.json({ due: [] });
    }
    const due = await listDueForUser(getDb(), ctx.userId, {
      workspaceId: ctx.workspaceId,
      ...(deckId ? { deckId } : {}),
    });
    return NextResponse.json({ due });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
