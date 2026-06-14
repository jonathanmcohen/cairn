import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { countInboxItems } from '@/lib/inbox/count';

/**
 * GET /api/inbox/count
 *
 * v0.10.2 S9 — returns `{ count }`: the number of still-untriaged captures in
 * the caller's active workspace inbox (the same rows the /inbox triage list
 * renders). Pure COUNT query — no row payloads — so the sidebar badge can
 * fetch it on every mount without dragging the capture list across the wire.
 */
export async function GET(_req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const value = await countInboxItems(getDb(), { workspaceId: ctx.workspaceId });
    return NextResponse.json({ count: value });
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
