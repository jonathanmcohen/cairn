import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { deleteComment } from '@/lib/comments/delete';
import { editComment } from '@/lib/comments/edit';
import { reopenComment, resolveComment } from '@/lib/comments/resolve';

type RouteCtx = { params: Promise<{ commentId: string }> };

const PatchInput = z.union([
  z.object({ resolved: z.boolean() }),
  z.object({ body: z.string().min(1).max(10_000) }),
]);

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { commentId } = await params;
    const ctx = await requireRole('editor');
    const parsed = PatchInput.parse(await req.json());
    if ('body' in parsed) {
      const updated = await editComment(getDb(), {
        commentId,
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        actorRole: ctx.role,
        body: parsed.body,
      });
      return NextResponse.json(updated);
    }
    const scope = { commentId, workspaceId: ctx.workspaceId };
    const updated = parsed.resolved
      ? await resolveComment(getDb(), scope)
      : await reopenComment(getDb(), scope);
    return NextResponse.json(updated);
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { commentId } = await params;
    const ctx = await requireRole('viewer');
    await deleteComment(getDb(), {
      commentId,
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      actorRole: ctx.role,
    });
    return new NextResponse(null, { status: 204 });
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
