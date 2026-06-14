import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { createDeck, deckCounts, listDecks } from '@/lib/flashcards/decks';

export const runtime = 'nodejs';

/**
 * GET  /api/flashcards/decks — list the active workspace's decks with per-user
 *      card counts. Response shape:
 *
 *      {
 *        decks: DeckRow[],   // all fields incl. F2 hierarchy + option columns
 *        counts: Array<{     // one entry per deck that has ≥1 eligible card
 *          deckId: string;
 *          new: number;      // no review row for this user
 *          learning: number; // interval = 0
 *          review: number;   // interval 1–20
 *          mature: number;   // interval ≥ 21
 *        }>
 *      }
 *
 *      Decks with zero eligible cards appear in `decks` but not in `counts`
 *      (the UI treats missing counts as all-zero). The F2-C UI consumes this
 *      shape to render the deck tree with per-node study stats.
 *
 * POST /api/flashcards/decks — create a named deck. 409 on duplicate name.
 *
 * Workspace-scoped: every deck row carries `workspace_id`, and all helpers
 * scope on `ctx.workspaceId`, so cross-workspace decks are never visible or
 * mutable.
 */
export async function GET(): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const db = getDb();
    const [decks, counts] = await Promise.all([
      listDecks(db, ctx.workspaceId),
      deckCounts(db, ctx.userId, ctx.workspaceId),
    ]);
    return NextResponse.json({ decks, counts });
  } catch (err) {
    return errorResponse(err);
  }
}

const CreateBody = z.object({ name: z.string().trim().min(1).max(120) });

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const parsed = CreateBody.parse(await req.json());
    const deck = await createDeck(getDb(), ctx.workspaceId, parsed.name);
    return NextResponse.json({ deck }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'A deck with that name already exists') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return errorResponse(err);
  }
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json({ error: 'internal' }, { status: 500 });
}
