import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { renameDeck } from '@/lib/flashcards/decks';

export const runtime = 'nodejs';

/**
 * PATCH /api/flashcards/decks/[id] — rename a deck. Workspace-scoped: a deck id
 * from another workspace resolves to "Deck not found" → 404 (existence-hiding,
 * mirrors the page-access convention). 409 on a name that collides with another
 * deck in the same workspace.
 */
const Body = z.object({ name: z.string().trim().min(1).max(120) });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }
    const parsed = Body.parse(await req.json());
    const deck = await renameDeck(getDb(), ctx.workspaceId, id, parsed.name);
    return NextResponse.json({ deck });
  } catch (err) {
    if (err instanceof Error && err.message === 'A deck with that name already exists') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof Error && err.message === 'Deck not found') {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
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
