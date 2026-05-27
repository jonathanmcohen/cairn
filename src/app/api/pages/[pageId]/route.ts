import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, hasMinRole } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { softDeletePage } from '@/lib/pages/delete';
import { PageLockedError } from '@/lib/pages/lock';
import { PageConflictError, updatePage } from '@/lib/pages/update';
import { snapshotIfChanged } from '@/lib/pages/versions';

type RouteCtx = { params: Promise<{ pageId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page } = await requirePageAccess(pageId, 'viewer');
    return NextResponse.json(page);
  } catch (err) {
    return errorToResponse(err);
  }
}

const PatchInput = z.object({
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(8).nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  content: z.unknown().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const parsed = PatchInput.parse(await req.json());
    const updated = await updatePage(getDb(), {
      pageId,
      workspaceId: ctx.workspaceId,
      patch: {
        title: parsed.title,
        icon: parsed.icon === undefined ? undefined : parsed.icon,
        coverUrl: parsed.coverUrl === undefined ? undefined : parsed.coverUrl,
        content: parsed.content,
      },
      expectedUpdatedAt: parsed.expectedUpdatedAt ? new Date(parsed.expectedUpdatedAt) : undefined,
      // v0.9.0 G2 P14 — page-lock gate. Editors can only write through their
      // own lock; admins implicitly bypass.
      byUserId: ctx.userId,
      adminOverride: hasMinRole(ctx.role, 'admin'),
    });
    if (parsed.content !== undefined) {
      try {
        await snapshotIfChanged(getDb(), {
          pageId,
          content: parsed.content,
          authorId: ctx.userId,
        });
      } catch {
        // best-effort: never let a snapshot failure break the save
      }
    }
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof PageConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return errorToResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    await softDeletePage(getDb(), {
      pageId,
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      adminOverride: hasMinRole(ctx.role, 'admin'),
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof PageLockedError) {
    // v0.9.0 G2 P14 — surface the lock state so the client can show a banner
    // ("Locked by <name>, auto-unlocks in 1h") without an extra round-trip.
    return NextResponse.json({ error: err.code, state: err.state }, { status: err.status });
  }
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'unknown';
  return NextResponse.json({ error: message }, { status: 500 });
}
