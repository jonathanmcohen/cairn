import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, hasMinRole } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { PageLockedError } from '@/lib/pages/lock';
import { movePage } from '@/lib/pages/move';

const MoveInput = z.object({
  newParentId: z.uuid().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const parsed = MoveInput.parse(await req.json());
    await movePage(getDb(), {
      pageId,
      workspaceId: ctx.workspaceId,
      newParentId: parsed.newParentId,
      // v0.9.0 G2 P14 — page-lock gate.
      byUserId: ctx.userId,
      adminOverride: hasMinRole(ctx.role, 'admin'),
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof PageLockedError) {
      return NextResponse.json({ error: err.code, state: err.state }, { status: err.status });
    }
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    if (/cycle|workspace|self/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
