import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError } from '@/lib/auth/require-role';
import { countMyOpenTasks } from '@/lib/tasks/aggregate';

/**
 * GET /api/tasks/count
 *
 * v0.10.2 S9 — returns `{ count }`: the caller's OPEN tasks across every
 * workspace/page they can read. Scoped exactly like the /my-tasks page's
 * default view (status=open, no workspace filter — the hub aggregates across
 * workspaces by design), so the sidebar badge always matches what clicking
 * the row shows. Like that page, it only needs a signed-in user — no active
 * workspace required (`listMyTasks`' ACL chain already gates per page).
 */
export async function GET(_req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext();
    if (!ctx?.userId) throw new HttpError(401, 'Not authenticated');
    const value = await countMyOpenTasks(getDb(), ctx.userId);
    return NextResponse.json({ count: value });
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
