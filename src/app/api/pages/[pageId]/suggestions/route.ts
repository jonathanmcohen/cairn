import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { listOpenSuggestions, proposeSuggestion } from '@/lib/suggestions/index-sync';

type RouteCtx = { params: Promise<{ pageId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    await requirePageAccess(pageId, 'editor');
    const suggestions = await listOpenSuggestions(getDb(), pageId);
    return NextResponse.json({ suggestions });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const suggestionId = await proposeSuggestion(getDb(), { pageId, authorId: ctx.userId });
    return NextResponse.json({ suggestionId }, { status: 201 });
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
