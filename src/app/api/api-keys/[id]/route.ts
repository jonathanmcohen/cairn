import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { RevokeKeyError, revokeKey } from '@/lib/api/keys';
import { HttpError, requireRole } from '@/lib/auth/require-role';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    // Helper scopes the delete to the workspace and writes the audit row in the
    // same transaction; cross-workspace ids 404.
    await revokeKey(getDb(), {
      workspaceId: ctx.workspaceId,
      keyId: id,
      actorUserId: ctx.userId,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof RevokeKeyError) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
