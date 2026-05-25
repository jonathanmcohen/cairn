import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { PageCoverSchema, setPageCover } from '@/lib/pages/cover';

export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ pageId: string }> };

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.workspaceId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { pageId } = await params;

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = PageCoverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid cover', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const ok = await setPageCover(getDb(), {
    pageId,
    workspaceId: ctx.workspaceId,
    cover: parsed.data,
  });
  if (!ok) {
    // Cross-workspace or page-doesn't-exist: 404, not 403 — matches
    // `requirePageAccess` so callers can't probe for existence.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
