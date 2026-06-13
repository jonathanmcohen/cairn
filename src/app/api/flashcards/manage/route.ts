import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { flashcardsToCsv } from '@/lib/flashcards/csv';
import { type CardState, listCards, type ManageFilters } from '@/lib/flashcards/manage';

export const runtime = 'nodejs';

const STATES = ['new', 'learning', 'review', 'suspended'] as const;

/**
 * GET /api/flashcards/manage — the workspace's manage table for the calling
 * user, with query-param filters:
 *   deck=<uuid> · tag=<string> · state=new|learning|review|suspended
 *   dueBefore=<iso> · dueAfter=<iso> · sourcePageExists=true|false
 *   search=<string> (front OR back, case-insensitive)
 *   ids=<uuid,uuid,…> (restrict to a selection — used by CSV export)
 *   format=csv (download the rows as RFC-4180 CSV instead of JSON)
 *
 * Workspace-scoped via `listCards`'s `workspaceId` predicate; the per-user SM-2
 * state is LEFT-JOINed on `ctx.userId`.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const url = new URL(req.url);
    const filters = parseFilters(url);
    if (filters.error) {
      return NextResponse.json({ error: 'validation', issues: filters.error }, { status: 400 });
    }

    let cards = await listCards(getDb(), ctx.workspaceId, ctx.userId, filters.value);

    // Optional selection restriction (CSV export of just the picked cards).
    const idsParam = url.searchParams.get('ids');
    if (idsParam) {
      const ids = new Set(idsParam.split(',').filter((s) => s.length > 0));
      cards = cards.filter((c) => ids.has(c.id));
    }

    if (url.searchParams.get('format') === 'csv') {
      const csv = flashcardsToCsv(cards);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="flashcards.csv"',
        },
      });
    }

    return NextResponse.json({
      cards: cards.map((c) => ({
        ...c,
        sourceOrphanedAt: c.sourceOrphanedAt?.toISOString() ?? null,
        suspendedAt: c.suspendedAt?.toISOString() ?? null,
        dueAt: c.dueAt?.toISOString() ?? null,
        lastReviewedAt: c.lastReviewedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

function parseFilters(
  url: URL,
): { value: ManageFilters; error?: undefined } | { error: string; value?: undefined } {
  const sp = url.searchParams;
  const filters: ManageFilters = {};

  const deck = sp.get('deck');
  if (deck) {
    if (!z.uuid().safeParse(deck).success) return { error: 'deck must be a uuid' };
    filters.deckId = deck;
  }
  const tag = sp.get('tag');
  if (tag) filters.tag = tag;

  const state = sp.get('state');
  if (state) {
    if (!(STATES as readonly string[]).includes(state)) return { error: 'invalid state' };
    filters.state = state as CardState;
  }

  const dueBefore = sp.get('dueBefore');
  if (dueBefore) {
    const d = new Date(dueBefore);
    if (Number.isNaN(d.getTime())) return { error: 'dueBefore must be a date' };
    filters.dueBefore = d;
  }
  const dueAfter = sp.get('dueAfter');
  if (dueAfter) {
    const d = new Date(dueAfter);
    if (Number.isNaN(d.getTime())) return { error: 'dueAfter must be a date' };
    filters.dueAfter = d;
  }

  const exists = sp.get('sourcePageExists');
  if (exists === 'true') filters.sourcePageExists = true;
  else if (exists === 'false') filters.sourcePageExists = false;

  const search = sp.get('search');
  if (search) filters.search = search;

  return { value: filters };
}
