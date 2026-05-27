/**
 * v0.9.0 G4 P23 — POST /api/pages/[pageId]/tasks/[blockId]/toggle.
 *
 * Flips the boolean checked attr of the TipTap taskItem identified by
 * (pageId, blockId). Requires editor on the page. Returns the new checked
 * state. Errors surface as HttpError-shaped 4xx/5xx JSON responses.
 */
import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { toggleTaskCheck } from '@/lib/tasks/toggle';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ pageId: string; blockId: string }> },
): Promise<Response> {
  try {
    const { pageId, blockId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const { checked } = await toggleTaskCheck({
      pageId,
      blockId,
      userId: ctx.userId,
    });
    return NextResponse.json({ checked }, { status: 200 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    if (/not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (/encrypted/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
