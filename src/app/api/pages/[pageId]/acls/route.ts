import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import { removePageAcl, requirePageAcl, setPageAcl } from '@/lib/pages/acl';
import { listPageAcls } from '@/lib/pages/acl-list';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ pageId: string }> };

const PutBody = z.object({
  userId: z.uuid(),
  permission: z.enum(['view', 'comment', 'edit']),
});
const DeleteBody = z.object({ userId: z.uuid() });

function toError(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    { status: 500 },
  );
}

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    await requirePageAcl(pageId, 'edit');
    const acls = await listPageAcls(getDb(), pageId);
    return NextResponse.json({ acls });
  } catch (err) {
    return toError(err);
  }
}

export async function PUT(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAcl(pageId, 'edit');
    const body = PutBody.parse(await req.json());

    // The target must be a member of the page's workspace; an editor cannot
    // grant access to a user outside the workspace.
    const [member] = await getDb()
      .select({ userId: schema.workspaceMembers.userId })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, page.workspaceId),
          eq(schema.workspaceMembers.userId, body.userId),
        ),
      )
      .limit(1);
    if (!member) {
      return NextResponse.json({ error: 'user is not a workspace member' }, { status: 400 });
    }

    await setPageAcl(getDb(), {
      workspaceId: page.workspaceId,
      pageId,
      userId: body.userId,
      permission: body.permission,
      actorUserId: ctx.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toError(err);
  }
}

export async function DELETE(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAcl(pageId, 'edit');
    const body = DeleteBody.parse(await req.json());

    await removePageAcl(getDb(), {
      workspaceId: page.workspaceId,
      pageId,
      userId: body.userId,
      actorUserId: ctx.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toError(err);
  }
}
