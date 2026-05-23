import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import {
  HttpError,
  type MemberRole,
  requireRole,
  type WorkspaceContext,
} from '@/lib/auth/require-role';
import { createComment } from '@/lib/comments/create';
import { listCommentsByTarget } from '@/lib/comments/list';
import { resolveTarget } from '@/lib/comments/target';
import { requirePageAccess } from '@/lib/pages/access';

type RouteCtx = { params: Promise<{ databaseId: string; rowId: string }> };

/**
 * Gate a row-comment request: authenticate + resolve the active workspace,
 * confirm the row lives in it, then enforce the role against the row's owning
 * page. A row whose database has no page (shouldn't happen — databases.pageId
 * is NOT NULL) is treated as not found rather than silently bypassing the
 * page-level check.
 */
async function gateRow(rowId: string, role: MemberRole): Promise<WorkspaceContext> {
  const ctx = await requireRole('viewer');
  const resolved = await resolveTarget(getDb(), ctx.workspaceId, { type: 'db_row', id: rowId });
  if (resolved.pageId == null) throw new HttpError(404, 'Target not found');
  await requirePageAccess(resolved.pageId, role);
  return ctx;
}

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { rowId } = await params;
    const ctx = await gateRow(rowId, 'viewer');
    const comments = await listCommentsByTarget(
      getDb(),
      { type: 'db_row', id: rowId },
      ctx.workspaceId,
    );
    return NextResponse.json(comments);
  } catch (err) {
    return errorToResponse(err);
  }
}

const PostInput = z.object({
  body: z.string().min(1).max(10_000),
});

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { rowId } = await params;
    const ctx = await gateRow(rowId, 'editor');
    const parsed = PostInput.parse(await req.json());
    const { comment } = await createComment(getDb(), {
      workspaceId: ctx.workspaceId,
      authorId: ctx.userId,
      body: parsed.body,
      target: { type: 'db_row', id: rowId },
    });
    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'unknown';
  return NextResponse.json({ error: message }, { status: 500 });
}
