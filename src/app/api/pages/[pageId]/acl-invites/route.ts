import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAcl } from '@/lib/pages/acl';
import {
  createPageAclInvite,
  listPageAclInvites,
  revokePageAclInvite,
} from '@/lib/pages/acl-invites';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ pageId: string }> };

const PostBody = z.object({
  email: z.email(),
  permission: z.enum(['view', 'comment', 'edit', 'owner']),
});
const DeleteBody = z.object({ inviteId: z.uuid() });

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
    return NextResponse.json({ invites: await listPageAclInvites(getDb(), pageId) });
  } catch (err) {
    return toError(err);
  }
}

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAcl(pageId, 'edit');
    const body = PostBody.parse(await req.json());
    // 'owner' invites require page-owner tier on the actor.
    if (body.permission === 'owner') await requirePageAcl(pageId, 'owner');
    await createPageAclInvite(getDb(), {
      workspaceId: page.workspaceId,
      pageId,
      email: body.email,
      permission: body.permission,
      invitedBy: ctx.userId,
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
    await revokePageAclInvite(getDb(), {
      workspaceId: page.workspaceId,
      pageId,
      inviteId: body.inviteId,
      actorUserId: ctx.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toError(err);
  }
}
