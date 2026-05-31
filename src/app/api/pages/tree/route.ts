import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError } from '@/lib/auth/require-role';
import { flattenedPageTree } from '@/lib/pages/tree';

/**
 * v0.9.6 G6 (#124) — destination list for the Move-To picker. Reuses the same
 * server-side `flattenedPageTree` the sidebar renders (DFS order + depth), so
 * the picker indentation matches the sidebar exactly. Read-only; any signed-in
 * workspace member may list pages (the actual reparent is `editor`-gated by the
 * move route). Draft visibility follows the sidebar rule via `viewerUserId`.
 */
export async function GET(_req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext();
    if (!ctx?.userId || !ctx.workspaceId) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const nodes = await flattenedPageTree(getDb(), ctx.workspaceId, ctx.userId);
    return NextResponse.json({ nodes });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
