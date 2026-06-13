import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { mergeDeck } from '@/lib/flashcards/decks';

export const runtime = 'nodejs';

/**
 * POST /api/flashcards/decks/[id]/merge — merge source deck ([id]) INTO a
 * target deck. Re-points all cards from source → target, reparents source's
 * children to target, then deletes the source deck. SM-2 review state on cards
 * is untouched.
 *
 * Body: { targetDeckId: uuid }
 *
 * Status codes:
 *   200  success — { ok: true, cardsMoved, childrenReparented }
 *   400  self-merge / invalid uuid / body validation
 *   404  source or target deck not found
 *   409  would delete Default deck (source === Default)
 */
const Body = z.object({ targetDeckId: z.uuid() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) {
      return NextResponse.json({ error: 'Source deck not found' }, { status: 404 });
    }
    const parsed = Body.parse(await req.json());
    const result = await mergeDeck(getDb(), ctx.workspaceId, id, parsed.targetDeckId, ctx.userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message === 'Cannot merge a deck into itself') {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Error && err.message === 'Cannot delete the Default deck') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (
      err instanceof Error &&
      (err.message === 'Source deck not found' || err.message === 'Target deck not found')
    ) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
