import { getDb } from '@/db/client';
import { HttpError, getAuthContext } from '@/lib/auth/require-role';
import { LeaveError, leaveWorkspace } from '@/lib/workspaces/leave';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const IdSchema = z.string().uuid();

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new HttpError(401, 'Not authenticated');
    const { id } = await params;
    const workspaceId = IdSchema.parse(id);

    await leaveWorkspace(getDb(), { workspaceId, userId: ctx.userId });
    // Cookie cleanup is unnecessary: the next getAuthContext re-validates the
    // stale cairn_ws against live membership and falls back automatically.
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof LeaveError) {
      const status = err.code === 'NOT_MEMBER' ? 404 : 409;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
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
