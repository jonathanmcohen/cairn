import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { findUnlinkedMentions } from '@/lib/pages/unlinked-mentions';

const Params = z.object({ pageId: z.uuid() });

type RouteCtx = { params: Promise<{ pageId: string }> };

/**
 * GET /api/pages/[pageId]/unlinked-mentions
 *
 * Returns up to 20 pages in the caller's workspace whose body mentions the
 * target page's title via Postgres FTS but which are NOT already linked to
 * the target via `page_links`. Each row carries a `ts_headline` snippet for
 * the BacklinksPanel "Unlinked mentions" section.
 *
 * Gated by `requirePageAccess(pageId, 'viewer')` — same gate as the existing
 * /backlinks route, so this never reveals data the caller couldn't already see.
 */
export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = Params.parse(await params);
    const { ctx } = await requirePageAccess(pageId, 'viewer');
    const mentions = await findUnlinkedMentions(getDb(), {
      pageId,
      workspaceId: ctx.workspaceId,
    });
    return NextResponse.json({ mentions });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
