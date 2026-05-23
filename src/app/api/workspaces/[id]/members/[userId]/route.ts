import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { AdminMemberError, removeMember, setMemberRole } from '@/lib/workspaces/admin-members';

// PATCH body. We intentionally accept 'owner' here so a misuse maps to the
// helper's CANNOT_SET_OWNER (400) rather than a Zod-validation error — the API
// surface tells callers "use transfer-ownership" rather than "owner isn't a
// real role."
const RoleBody = z.object({ role: z.enum(['viewer', 'editor', 'admin', 'owner']) });
const IdSchema = z.uuid();

function mapAdminError(err: AdminMemberError): Response {
  // 400 for caller-input errors; 409 for state-conflict (last owner, removing
  // an owner without transferring first).
  const status = err.code === 'CANNOT_SET_OWNER' || err.code === 'CANNOT_REMOVE_SELF' ? 400 : 409;
  return NextResponse.json({ error: err.message, code: err.code }, { status });
}

function toResponse(err: unknown): Response {
  if (err instanceof AdminMemberError) return mapAdminError(err);
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
): Promise<Response> {
  try {
    const { id, userId } = await params;
    const workspaceId = IdSchema.parse(id);
    const targetUserId = IdSchema.parse(userId);
    const ctx = await requireRole('admin');
    // Active workspace must match the URL workspaceId — otherwise we'd leak
    // existence of cross-workspace ids. 404 (not 403) matches the
    // requirePageAccess convention.
    if (ctx.workspaceId !== workspaceId) throw new HttpError(404, 'Workspace not found');
    const { role } = RoleBody.parse(await req.json().catch(() => ({})));
    await setMemberRole(getDb(), {
      workspaceId,
      actorUserId: ctx.userId,
      targetUserId,
      role,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return toResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
): Promise<Response> {
  try {
    const { id, userId } = await params;
    const workspaceId = IdSchema.parse(id);
    const targetUserId = IdSchema.parse(userId);
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== workspaceId) throw new HttpError(404, 'Workspace not found');
    await removeMember(getDb(), {
      workspaceId,
      actorUserId: ctx.userId,
      targetUserId,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return toResponse(err);
  }
}
