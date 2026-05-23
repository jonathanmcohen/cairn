import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { listPageActivity } from '@/lib/audit/query';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';

type RouteCtx = { params: Promise<{ pageId: string }> };

const Query = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

/**
 * Per-page activity feed. Gated `viewer+` via `requirePageAccess`, which also
 * enforces workspace ownership (cross-workspace ids resolve to 404). The audit
 * rows themselves are workspace-scoped, so we pass `ctx.workspaceId` into
 * `listPageActivity` as a second isolation belt.
 */
export async function GET(req: NextRequest, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'viewer');
    const url = new URL(req.url);
    const parsed = Query.parse(Object.fromEntries(url.searchParams));
    const result = await listPageActivity(getDb(), {
      workspaceId: ctx.workspaceId,
      pageId,
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return NextResponse.json(result);
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
