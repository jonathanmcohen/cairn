/**
 * G16 #163 — page lifecycle status REST surface.
 *
 * GET returns the current status; POST drives an allowed transition through the
 * `transitionStatus` gate (which records the `page.status_changed` audit row).
 * Illegal transitions map to 409 so the picker can distinguish "not allowed"
 * from a generic bad request.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { PAGE_STATUSES } from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { IllegalStatusTransition, transitionStatus } from '@/lib/pages/status';

type RouteCtx = { params: Promise<{ pageId: string }> };

const PostSchema = z.object({ to: z.enum(PAGE_STATUSES) }).strict();

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page } = await requirePageAccess(pageId, 'viewer');
    return NextResponse.json({ status: page.status });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const body = PostSchema.parse((await req.json().catch(() => ({}))) as unknown);
    const result = await transitionStatus(getDb(), {
      pageId,
      to: body.to,
      byUserId: ctx.userId,
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof IllegalStatusTransition) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  throw err;
}
