import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { requireSpaceAccess } from '@/lib/spaces/access';

const Schema = z.object({ spaceId: z.uuid().nullable() });

/**
 * Reassigns a page to a different space (or NULL = "Unfiled"). The caller
 * must have `editor` on the page AND (if a non-null `spaceId` is given)
 * `editor` on the destination space via the per-space ACL chain.
 */
export async function POST(
  req: Request,
  ctxArg: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const { pageId } = await ctxArg.params;
    // requirePageAccess validates active-workspace membership + edit role,
    // and returns 404 for cross-workspace ids (existence-hiding).
    const { ctx } = await requirePageAccess(pageId, 'editor');

    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    if (parsed.data.spaceId) {
      const access = await requireSpaceAccess(getDb(), {
        spaceId: parsed.data.spaceId,
        userId: ctx.userId,
        minRole: 'editor',
        workspaceId: ctx.workspaceId,
      });
      if (!access.ok) {
        return NextResponse.json(
          { error: access.code },
          { status: access.code === 'not_found' ? 404 : 403 },
        );
      }
    }

    await getDb()
      .update(schema.pages)
      .set({ spaceId: parsed.data.spaceId })
      .where(eq(schema.pages.id, pageId));
    await recordAudit(getDb(), {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'page.moved_space',
      targetType: 'page',
      targetId: pageId,
      metadata: { spaceId: parsed.data.spaceId },
    });
    return NextResponse.json({ ok: true });
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
