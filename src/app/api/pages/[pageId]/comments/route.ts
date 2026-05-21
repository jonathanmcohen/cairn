import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { CommentAnchorSchema } from '@/lib/comments/anchor';
import { createComment } from '@/lib/comments/create';
import { listComments } from '@/lib/comments/list';
import { requirePageAccess } from '@/lib/pages/access';

type RouteCtx = { params: Promise<{ pageId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'viewer');
    const comments = await listComments(getDb(), pageId, ctx.workspaceId);
    return NextResponse.json(comments);
  } catch (err) {
    return errorToResponse(err);
  }
}

const PostInput = z.object({
  body: z.string().min(1).max(10_000),
  anchor: CommentAnchorSchema.nullish(),
});

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const parsed = PostInput.parse(await req.json());
    // `mentionedUserIds` is the seam Plan 6 consumes (notifyMentions); this
    // plan only surfaces the parsed ids and does not create notifications.
    const { comment } = await createComment(getDb(), {
      workspaceId: ctx.workspaceId,
      pageId,
      authorId: ctx.userId,
      body: parsed.body,
      anchor: parsed.anchor ?? null,
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
