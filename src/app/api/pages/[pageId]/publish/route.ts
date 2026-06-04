import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { previewPublicSlug, publishPage } from '@/lib/pages/publish';

type RouteCtx = { params: Promise<{ pageId: string }> };

/**
 * Non-mutating publish preview (#70/#249). Returns the slug + `/p/<slug>` URL
 * the page *would* receive on publish so the confirm dialog can show the real
 * public link before the user commits. Viewer-gated read; never flips
 * `published`. `minted` indicates whether the slug is already final (the page
 * was published before) vs. a deterministic preview base.
 */
export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page } = await requirePageAccess(pageId, 'viewer');
    const slug = previewPublicSlug({ title: page.title ?? '', publicSlug: page.publicSlug });
    return NextResponse.json({ slug, url: `/p/${slug}`, minted: page.publicSlug != null });
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

export async function POST(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const { slug } = await publishPage(getDb(), {
      pageId,
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
    });
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
