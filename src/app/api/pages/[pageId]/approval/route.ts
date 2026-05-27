/**
 * v0.9.0 G4 P24 — Page approval REST surface (request + history).
 *
 * - `POST /api/pages/[pageId]/approval` — body `{action: 'request'}`. Editor+
 *   moves the page into `review` and writes the `page.approval_requested`
 *   audit row.
 * - `GET /api/pages/[pageId]/approval` — viewer+ pulls reverse-chronological
 *   approval history for the page. Used by the in-header ApprovalPanel.
 *
 * The decide route is a sibling file at `./decide/route.ts` (admin-only).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { listApprovals, requestApproval } from '@/lib/pages/approval';

type RouteCtx = { params: Promise<{ pageId: string }> };

const PostSchema = z.object({ action: z.literal('request') }).strict();

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const raw = (await req.json().catch(() => ({}))) as unknown;
    PostSchema.parse(raw);
    await requestApproval(getDb(), {
      pageId,
      byUserId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    await requirePageAccess(pageId, 'viewer');
    const history = await listApprovals(getDb(), pageId);
    return NextResponse.json({
      history: history.map((h) => ({
        ...h,
        approvedAt: h.approvedAt.toISOString(),
      })),
    });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  throw err;
}
