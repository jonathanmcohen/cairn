/**
 * v0.9.0 G4 P24 — Admin decision endpoint.
 *
 * `POST /api/pages/[pageId]/approval/decide` — body
 * `{decision: 'approved'|'rejected'|'requested_changes', comment?: string}`.
 * Requires `admin` per the workspace-role check in `requirePageAccess`. The
 * library layer (`decide`) snapshots the latest `page_versions` id at call
 * time, HMAC-signs it under AUTH_SECRET, writes `page_approvals` + audit +
 * advances `pages.status` atomically.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { decide, NoVersionSnapshotError } from '@/lib/pages/approval';

type RouteCtx = { params: Promise<{ pageId: string }> };

const Schema = z
  .object({
    decision: z.enum(['approved', 'rejected', 'requested_changes']),
    comment: z.string().max(2000).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'admin');
    const raw = (await req.json().catch(() => ({}))) as unknown;
    const body = Schema.parse(raw);
    const result = await decide(getDb(), {
      pageId,
      approverUserId: ctx.userId,
      workspaceId: ctx.workspaceId,
      decision: body.decision,
      comment: body.comment,
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
  if (err instanceof NoVersionSnapshotError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  throw err;
}
