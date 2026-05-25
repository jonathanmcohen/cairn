import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { markAllRead } from '@/lib/notifications/list';

/**
 * POST /api/notifications/mark-all-read
 *
 * Bulk mark-read used by the bell drawer footer + the /notifications page.
 * Scoped to the caller's (userId, workspaceId); cross-workspace rows for the
 * same user are NOT touched. Returns `{ affected }` so the UI can confirm the
 * batch flipped without an extra round-trip.
 */
export async function POST(_req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const result = await markAllRead(getDb(), {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
