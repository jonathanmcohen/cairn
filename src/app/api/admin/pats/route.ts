import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { listWorkspacePats } from '@/lib/auth/pat-admin-list';
import { HttpError, requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

/**
 * Admin-only listing of every PAT in the active workspace + per-token usage
 * rollups (current day + month + last 14 daily rollups for sparkline).
 *
 * Existence-hiding: no `workspaceId` param — always scoped to the caller's
 * active workspace. Cross-workspace requests are impossible by construction.
 *
 * v0.9.0 G1 P10. The response NEVER contains `token_hash`, `token_prefix`,
 * or plaintext — `listWorkspacePats` strips them by selecting an explicit
 * column projection.
 */
export async function GET(_req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const rows = await listWorkspacePats(getDb(), ctx.workspaceId);
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
