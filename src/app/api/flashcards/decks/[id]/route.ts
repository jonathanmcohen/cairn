import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { deleteDeck, renameDeck, reparentDeck, setDeckOptions } from '@/lib/flashcards/decks';

export const runtime = 'nodejs';

/**
 * PATCH /api/flashcards/decks/[id] — update a deck's name, display options, or
 * parent. A single PATCH may combine name + options; `parentDeckId` triggers
 * reparentDeck separately. Workspace-scoped: a deck id from another workspace
 * resolves to "Deck not found" → 404.
 *
 * Body fields (all optional):
 *   name            string (1–120)                   → renameDeck
 *   icon            string|null (max 64)              → setDeckOptions
 *   color           string|null                       → setDeckOptions
 *   defaultNewPerDay  int|null                        → setDeckOptions
 *   defaultReviewLimit int|null                       → setDeckOptions
 *   easeStart       number|null                       → setDeckOptions
 *   parentDeckId    uuid|null                         → reparentDeck
 *
 * Status codes:
 *   200  success
 *   400  validation / cycle-self / invalid-uuid
 *   404  deck not found
 *   409  name collision / cycle detected
 */
const Body = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  icon: z.string().max(64).nullable().optional(),
  color: z.string().nullable().optional(),
  defaultNewPerDay: z.number().int().nullable().optional(),
  defaultReviewLimit: z.number().int().nullable().optional(),
  easeStart: z.number().nullable().optional(),
  parentDeckId: z.uuid().nullable().optional(),
});

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
    const db = getDb();

    let deck: Awaited<ReturnType<typeof renameDeck>> | undefined;

    // Apply rename first (if provided)
    if (parsed.name !== undefined) {
      deck = await renameDeck(db, ctx.workspaceId, id, parsed.name);
    }

    // Apply options if any option field is provided
    const hasOptions =
      'icon' in parsed ||
      'color' in parsed ||
      'defaultNewPerDay' in parsed ||
      'defaultReviewLimit' in parsed ||
      'easeStart' in parsed;
    if (hasOptions) {
      deck = await setDeckOptions(db, ctx.workspaceId, id, {
        ...(parsed.icon !== undefined ? { icon: parsed.icon } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(parsed.defaultNewPerDay !== undefined
          ? { defaultNewPerDay: parsed.defaultNewPerDay }
          : {}),
        ...(parsed.defaultReviewLimit !== undefined
          ? { defaultReviewLimit: parsed.defaultReviewLimit }
          : {}),
        ...(parsed.easeStart !== undefined ? { easeStart: parsed.easeStart } : {}),
      });
    }

    // Apply reparent if parentDeckId key is present (including explicit null = move to root)
    if ('parentDeckId' in parsed) {
      deck = await reparentDeck(db, ctx.workspaceId, id, parsed.parentDeckId ?? null);
    }

    // If nothing was provided, still validate the deck exists (fetch it)
    if (!deck) {
      const { listDecks } = await import('@/lib/flashcards/decks');
      const decks = await listDecks(db, ctx.workspaceId);
      const found = decks.find((d) => d.id === id);
      if (!found) return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
      deck = found;
    }

    return NextResponse.json({ deck });
  } catch (err) {
    return deckErrorResponse(err);
  }
}

/**
 * DELETE /api/flashcards/decks/[id] — delete a deck.
 *
 * Requires `disposition` query param or JSON body:
 *   ?disposition=moveToDefault  → move cards to Default deck, deck deleted
 *   ?disposition=deleteCards    → hard-delete cards + reviews, deck deleted
 *
 * Returns 400 if disposition is missing or invalid.
 * Returns 400/409 if attempting to delete the Default deck.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    // Resolve disposition from query string or JSON body
    const url = new URL(req.url);
    let disposition: string | null = url.searchParams.get('disposition');
    if (!disposition) {
      try {
        const body = await req.json().catch(() => ({}));
        if (body && typeof body.disposition === 'string') {
          disposition = body.disposition;
        }
      } catch {
        // no body
      }
    }

    const DispositionSchema = z.enum(['moveToDefault', 'deleteCards']);
    const dispositionParsed = DispositionSchema.safeParse(disposition);
    if (!dispositionParsed.success) {
      return NextResponse.json(
        { error: 'disposition is required: moveToDefault or deleteCards' },
        { status: 400 },
      );
    }

    const result = await deleteDeck(
      getDb(),
      ctx.workspaceId,
      id,
      dispositionParsed.data,
      ctx.userId,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message === 'Cannot delete the Default deck') {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return deckErrorResponse(err);
  }
}

function deckErrorResponse(err: unknown): Response {
  if (err instanceof Error && err.message === 'A deck with that name already exists') {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof Error && err.message === 'Deck not found') {
    return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
  }
  if (
    err instanceof Error &&
    (err.message === 'Source deck not found' ||
      err.message === 'Target deck not found' ||
      err.message === 'Parent deck not found')
  ) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof Error && err.message === 'Cannot make a deck a child of itself') {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof Error && err.message.startsWith('Cycle detected')) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json({ error: 'internal' }, { status: 500 });
}
