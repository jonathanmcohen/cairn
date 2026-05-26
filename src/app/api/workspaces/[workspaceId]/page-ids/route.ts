import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
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
 *
 * Paginated via opaque `cursor` (last seen page id, UUID) + `limit` (1..1000,
 * default 200). Order is `id ASC`. Response:
 *   { pageIds: string[], nextCursor: string | null, rows: {id,title}[] }
 * `nextCursor` is the last id in this batch iff the batch is full (more rows
 * may exist), else null. `rows` preserves the old id+title shape for the UI.
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ workspaceId: string }> };

const Query = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export async function GET(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { workspaceId } = await params;
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const url = new URL(req.url);
    const qParsed = Query.safeParse({
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!qParsed.success) {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }
    const { cursor, limit } = qParsed.data;
    const db = getDb();
    const baseConds = [
      eq(pages.workspaceId, workspaceId),
      eq(pages.encrypted, false),
      isNull(pages.deletedAt),
    ];
    if (cursor) baseConds.push(gt(pages.id, cursor));
    const rows = await db
      .select({ id: pages.id, title: pages.title })
      .from(pages)
      .where(and(...baseConds))
      .orderBy(asc(pages.id))
      .limit(limit);
    const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
    return NextResponse.json({
      pageIds: rows.map((r) => r.id),
      nextCursor,
      rows,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
