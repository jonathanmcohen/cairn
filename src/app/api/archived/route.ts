import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { listArchivedPages } from '@/lib/pages/archived';

/**
 * v0.10.0 D5 — list the workspace's archived pages (mirrors GET /api/trash).
 * Viewer-gated read; un-archiving goes through the existing editor-gated
 * POST /api/pages/[pageId]/status route (`{ to: 'draft' }`), not a new write.
 */
export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const entries = await listArchivedPages(getDb(), ctx.workspaceId);
    return NextResponse.json({ entries });
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
