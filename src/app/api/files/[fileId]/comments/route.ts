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

type RouteCtx = { params: Promise<{ fileId: string }> };

/**
 * Gate a file-comment request: enforce the workspace-level role, confirm the
 * file lives in the active workspace (cross-workspace → 404), then — when the
 * file is attached to a page — additionally enforce the role against that
 * page. An unattached file (pageId null) relies on the workspace-level gate.
 */
async function gateFile(fileId: string, role: MemberRole): Promise<WorkspaceContext> {
  const ctx = await requireRole(role);
  const resolved = await resolveTarget(getDb(), ctx.workspaceId, { type: 'file', id: fileId });
  if (resolved.pageId != null) {
    await requirePageAccess(resolved.pageId, role);
  }
  return ctx;
}

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { fileId } = await params;
    const ctx = await gateFile(fileId, 'viewer');
    const comments = await listCommentsByTarget(
      getDb(),
      { type: 'file', id: fileId },
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
    const { fileId } = await params;
    const ctx = await gateFile(fileId, 'editor');
    const parsed = PostInput.parse(await req.json());
    const { comment } = await createComment(getDb(), {
      workspaceId: ctx.workspaceId,
      authorId: ctx.userId,
      body: parsed.body,
      target: { type: 'file', id: fileId },
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
