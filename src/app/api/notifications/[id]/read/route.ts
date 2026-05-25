import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { markRead } from '@/lib/notifications/list';

const Params = z.object({ id: z.uuid() });

/**
 * POST /api/notifications/[id]/read
 *
 * Per-row mark-read used by the bell drawer. Scoped by (userId, workspaceId);
 * a notification owned by another user (or another workspace) returns 404
 * (not 403) per the project-wide "never leak existence" convention — see
 * src/lib/pages/access.ts. Idempotent on already-read rows (also 404 because
 * the helper's isNull predicate matches zero rows).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const { id } = Params.parse(await params);
    const result = await markRead(getDb(), {
      id,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    if (result.affected === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
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
}
