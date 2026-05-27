import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { addPin, PinNotFoundError, reorderPins } from '@/lib/pins/crud';
import { listWorkspacePins } from '@/lib/pins/list';

/**
 * v0.9.0 G2 P12 — Workspace-pinned-pages routes.
 *
 * - GET: any workspace member (viewer+) so the sidebar can render the list
 *   for every signed-in user.
 * - POST / PUT / DELETE: admin-only (curation surface).
 *
 * Cross-workspace `pageId` returns 404 (existence-hiding) — never 403, which
 * would leak the page's existence to a different workspace's admin.
 */
export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const pins = await listWorkspacePins(getDb(), ctx.workspaceId);
    return NextResponse.json({ pins }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const PostSchema = z.object({ pageId: z.uuid() });

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = PostSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    try {
      const row = await addPin(getDb(), {
        workspaceId: ctx.workspaceId,
        pageId: parsed.data.pageId,
        actorId: ctx.userId,
      });
      return NextResponse.json(row, { status: 201 });
    } catch (err) {
      if (err instanceof PinNotFoundError) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

const PutSchema = z.object({ orderedPageIds: z.array(z.uuid()).max(200) });

export async function PUT(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = PutSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    try {
      await reorderPins(getDb(), {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        orderedPageIds: parsed.data.orderedPageIds,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'reorder_failed' },
        { status: 400 },
      );
    }
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
