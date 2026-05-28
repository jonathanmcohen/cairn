import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { removePin } from '@/lib/pins/crud';

/**
 * v0.9.0 G2 P12 — Remove a workspace pin (admin-only).
 *
 * Non-existent pin → 404. Like POST, the surface intentionally cannot
 * differentiate "page belongs to another workspace" from "page has never
 * been pinned" — both return the same 404 to avoid leaking page-existence
 * across workspace boundaries.
 */
export async function DELETE(
  _req: Request,
  ctxArg: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { pageId } = await ctxArg.params;
    const parsed = z.uuid().safeParse(pageId);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_page_id' }, { status: 400 });
    }
    const ok = await removePin(getDb(), {
      workspaceId: ctx.workspaceId,
      pageId,
      actorId: ctx.userId,
    });
    if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return new Response(null, { status: 204 });
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
