import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { listPendingInvites } from '@/lib/workspaces/invites';

const IdSchema = z.uuid();

function toResponse(err: unknown): Response {
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const workspaceId = IdSchema.parse(id);
    const ctx = await requireRole('admin');
    // Cross-workspace ids 404 to match the rest of the workspace API surface.
    if (ctx.workspaceId !== workspaceId) throw new HttpError(404, 'Workspace not found');
    const invites = await listPendingInvites(getDb(), workspaceId);
    return NextResponse.json({ invites }, { status: 200 });
  } catch (err) {
    return toResponse(err);
  }
}
