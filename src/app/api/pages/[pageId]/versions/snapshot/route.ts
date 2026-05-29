import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { snapshotIfChanged } from '@/lib/pages/versions';

type RouteCtx = { params: Promise<{ pageId: string }> };

/**
 * Manual "Save snapshot now" — a deliberate editor action that captures the
 * page's currently-persisted content as a version, forcing past the 60s
 * keystroke debounce (the content-dedupe still applies, so an unchanged page
 * is a no-op). The live editor autosaves content to `pages.content` via Yjs
 * materialization, so this reads the persisted page row server-side and needs
 * no client content payload.
 *
 * 201 + the inserted row when captured; 200 + { skipped: true } when the
 * latest version already matches the current content.
 */
export async function POST(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAccess(pageId, 'editor');
    const inserted = await snapshotIfChanged(
      getDb(),
      { pageId, content: page.content, authorId: ctx.userId },
      { force: true },
    );
    if (!inserted) {
      return NextResponse.json({ skipped: true }, { status: 200 });
    }
    return NextResponse.json(inserted, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
