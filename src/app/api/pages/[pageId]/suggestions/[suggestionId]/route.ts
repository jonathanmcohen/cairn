import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { acceptSuggestion, rejectSuggestion } from '@/lib/suggestions/index-sync';

type RouteCtx = { params: Promise<{ pageId: string; suggestionId: string }> };

const Body = z.object({ action: z.enum(['accept', 'reject']) });

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId, suggestionId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const { action } = Body.parse(await req.json());
    const fn = action === 'accept' ? acceptSuggestion : rejectSuggestion;
    const { resolved } = await fn(getDb(), { pageId, suggestionId, resolverId: ctx.userId });
    if (!resolved) {
      return NextResponse.json({ error: 'already_resolved' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'unknown';
  return NextResponse.json({ error: message }, { status: 500 });
}
