import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { pages } from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';

/**
 * v0.9.0 G1 P7 — GET /api/workspaces/[workspaceId]/page-ids.
 *
 * Lightweight helper used by the workspace-wide enable sweep driver to learn
 * which pages still need encrypting. Returns id + title for every page in the
 * workspace that is:
 *   - not soft-deleted (deleted_at IS NULL),
 *   - not already encrypted (encrypted = false).
 *
 * Admin-only (the only caller is the enable-sweep UI, which is admin-gated
 * upstream). Returned shape stays tight on purpose — the sweep driver only
 * needs ids; title is included so the UI can render "Encrypting <title>…".
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ workspaceId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { workspaceId } = await params;
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const db = getDb();
    const rows = await db
      .select({ id: pages.id, title: pages.title })
      .from(pages)
      .where(
        and(
          eq(pages.workspaceId, workspaceId),
          eq(pages.encrypted, false),
          isNull(pages.deletedAt),
        ),
      );
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
