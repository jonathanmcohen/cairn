import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { findUnlinkedMentions, getBacklinks } from '@/lib/pages/page-links';

type RouteCtx = { params: Promise<{ pageId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAccess(pageId, 'viewer');
    const db = getDb();
    const [backlinks, unlinkedMentions] = await Promise.all([
      getBacklinks(db, pageId),
      findUnlinkedMentions(db, {
        workspaceId: ctx.workspaceId,
        pageId,
        title: page.title,
      }),
    ]);
    return NextResponse.json({ backlinks, unlinkedMentions });
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
