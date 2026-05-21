import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { publishPage } from '@/lib/pages/publish';
import { NextResponse } from 'next/server';

type RouteCtx = { params: Promise<{ pageId: string }> };

export async function POST(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const { slug } = await publishPage(getDb(), { pageId, workspaceId: ctx.workspaceId });
    return NextResponse.json({ slug, url: `/p/${slug}` });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
