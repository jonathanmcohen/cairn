import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { DeleteWorkspaceError, deleteWorkspace } from '@/lib/workspaces/delete';

const IdSchema = z.uuid();

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const workspaceId = IdSchema.parse(id);
    const ctx = await requireRole('admin');
    // Cross-workspace id -> 404 (don't leak existence).
    if (ctx.workspaceId !== workspaceId) {
      throw new HttpError(404, 'Workspace not found');
    }
    if (ctx.role !== 'owner') {
      throw new HttpError(403, 'Only the owner can delete the workspace');
    }
    await deleteWorkspace(getDb(), { workspaceId, actorUserId: ctx.userId });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof DeleteWorkspaceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 403;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
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
}
