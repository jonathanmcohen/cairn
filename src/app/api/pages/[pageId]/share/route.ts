import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { setShareSettings } from '@/lib/pages/share';

type RouteCtx = { params: Promise<{ pageId: string }> };

const Body = z.object({
  // undefined = leave unchanged; null = clear; string = (re)hash.
  password: z.string().nullable().optional(),
  // ISO datetime string or null; undefined = leave unchanged.
  expiresAt: z.string().nullable().optional(),
  allowDuplication: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const body = Body.parse(await req.json());

    let expiresAt: Date | null | undefined;
    if (body.expiresAt !== undefined) {
      expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return NextResponse.json({ error: 'invalid expiresAt' }, { status: 400 });
      }
    }

    await setShareSettings(getDb(), {
      pageId,
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      password: body.password,
      expiresAt,
      allowDuplication: body.allowDuplication,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
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
}
