import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { listDueForUser } from '@/lib/flashcards/due-queue';

export const runtime = 'nodejs';

/**
 * GET /api/flashcards/due[?deck=<tag>] — the active workspace's due-queue for
 * the calling user. Workspace-scoped: only cards in the user's active
 * workspace count toward the queue.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const url = new URL(req.url);
    const deck = url.searchParams.get('deck');
    const due = await listDueForUser(getDb(), ctx.userId, {
      workspaceId: ctx.workspaceId,
      ...(deck ? { deckTag: deck } : {}),
    });
    return NextResponse.json({ due });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
