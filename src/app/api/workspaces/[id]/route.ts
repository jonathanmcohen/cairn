import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { auth } from '@/lib/auth/config';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { requireStepUp } from '@/lib/auth/stepup';
import { DeleteWorkspaceError, deleteWorkspace } from '@/lib/workspaces/delete';

const IdSchema = z.uuid();

/**
 * v0.9.0 G1 P8 — resolve the step-up timestamp from either the session JWT
 * (set via session.update from the assert client) or the `cairn_stepup`
 * fallback cookie set by /api/webauthn/assert. Either source survives a
 * fresh request; both expire on the same TTL.
 */
async function resolveStepUpAt(): Promise<number | null> {
  const session = (await auth()) as { stepUpAt?: number } | null;
  if (typeof session?.stepUpAt === 'number') return session.stepUpAt;
  const store = await cookies();
  const raw = store.get('cairn_stepup')?.value;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

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
    // Step-up gate: workspace-delete is the canonical sensitive op (v0.9.0
    // G1 P8). Missing/stale stepUpAt → 403 stepup-required so the client
    // can trigger an inline assertion + retry. The audit row makes the
    // attempt visible even when the request itself is blocked.
    const stepUpAt = await resolveStepUpAt();
    const stepUp = requireStepUp({ stepUpAt });
    if (!stepUp.ok) {
      await recordAudit(getDb(), {
        workspaceId,
        actorUserId: ctx.userId,
        action: 'mfa.stepup_required',
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: { op: 'workspace.delete' },
      });
      return NextResponse.json(
        { error: stepUp.message, code: stepUp.code },
        { status: stepUp.status },
      );
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
