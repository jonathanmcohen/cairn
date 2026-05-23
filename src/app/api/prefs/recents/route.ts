import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { listRecents, recordVisit } from '@/lib/prefs/user-page-prefs';

const VisitInput = z.object({ pageId: z.uuid() });

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const recents = await listRecents(getDb(), {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    return NextResponse.json({ recents }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { pageId } = VisitInput.parse(await req.json().catch(() => ({})));
    const { ctx } = await requirePageAccess(pageId, 'viewer');
    await recordVisit(getDb(), { userId: ctx.userId, workspaceId: ctx.workspaceId, pageId });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    { status: 500 },
  );
}
