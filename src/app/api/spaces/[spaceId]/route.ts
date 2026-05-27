import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { requireSpaceAccess } from '@/lib/spaces/access';
import { deleteSpace, updateSpace } from '@/lib/spaces/crud';

const PatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  icon: z.string().max(8).nullable().optional(),
  position: z.coerce.number().int().nonnegative().optional(),
});

export async function GET(
  _req: Request,
  ctxArg: { params: Promise<{ spaceId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { spaceId } = await ctxArg.params;
    const r = await requireSpaceAccess(getDb(), {
      spaceId,
      userId: ctx.userId,
      minRole: 'viewer',
      workspaceId: ctx.workspaceId,
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: r.code },
        { status: r.code === 'not_found' ? 404 : 403 },
      );
    }
    return NextResponse.json({ ok: true, role: r.role });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  ctxArg: { params: Promise<{ spaceId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { spaceId } = await ctxArg.params;
    // Existence-hiding: cross-workspace space → 404 before we ever update.
    const access = await requireSpaceAccess(getDb(), {
      spaceId,
      userId: ctx.userId,
      minRole: 'admin',
      workspaceId: ctx.workspaceId,
    });
    if (!access.ok) {
      return NextResponse.json(
        { error: access.code },
        { status: access.code === 'not_found' ? 404 : 403 },
      );
    }
    const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const updated = await updateSpace(getDb(), {
      spaceId,
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      ...parsed.data,
    });
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  ctxArg: { params: Promise<{ spaceId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { spaceId } = await ctxArg.params;
    // Confirm workspace ownership before deletion (existence-hiding).
    const access = await requireSpaceAccess(getDb(), {
      spaceId,
      userId: ctx.userId,
      minRole: 'admin',
      workspaceId: ctx.workspaceId,
    });
    if (!access.ok) {
      return NextResponse.json(
        { error: access.code },
        { status: access.code === 'not_found' ? 404 : 403 },
      );
    }
    const ok = await deleteSpace(getDb(), {
      spaceId,
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
    });
    if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function toErrorResponse(err: unknown): Response {
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
