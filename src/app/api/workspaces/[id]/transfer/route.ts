import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { TransferError, transferOwnership } from '@/lib/workspaces/transfer';

const Body = z.object({ toUserId: z.uuid() });
const IdSchema = z.uuid();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const workspaceId = IdSchema.parse(id);
    // Admin gate is the cheapest valid floor; we then require owner explicitly.
    const ctx = await requireRole('admin');
    // Cross-workspace id -> 404 (don't leak existence). Matches members route.
    if (ctx.workspaceId !== workspaceId) {
      throw new HttpError(404, 'Workspace not found');
    }
    if (ctx.role !== 'owner') {
      throw new HttpError(403, 'Only the owner can transfer ownership');
    }
    const { toUserId } = Body.parse(await req.json().catch(() => ({})));
    await transferOwnership(getDb(), {
      workspaceId,
      fromUserId: ctx.userId,
      toUserId,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof TransferError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
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
