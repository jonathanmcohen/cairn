import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { RevokeInviteError, revokeInvite } from '@/lib/workspaces/invites';

const IdSchema = z.uuid();

function toResponse(err: unknown): Response {
  if (err instanceof RevokeInviteError) {
    // NOT_FOUND → 404; collapsing "doesn't exist" and "already consumed" to the
    // same status avoids leaking which one it was.
    return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
  }
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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
): Promise<Response> {
  try {
    const { id, inviteId } = await params;
    const workspaceId = IdSchema.parse(id);
    const parsedInviteId = IdSchema.parse(inviteId);
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== workspaceId) throw new HttpError(404, 'Workspace not found');
    await revokeInvite(getDb(), {
      workspaceId,
      inviteId: parsedInviteId,
      actorUserId: ctx.userId,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return toResponse(err);
  }
}
