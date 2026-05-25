import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { reorderFavorites } from '@/lib/favorites/reorder';

// Back-compat shim for the v0.6/v0.7 endpoint. Accepts EITHER the new shape
// (`orderedFavoriteIds` = user_page_prefs.id[]) used by the v0.8.0 P17 helper,
// OR the legacy v0.6 shape (`orderedPageIds` = pages.id[]). For the legacy
// shape, resolve (userId, pageId) → favorite row ids and forward through the
// new `reorderFavorites` helper (which writes to `position` and enforces
// ownership in its WHERE clause). The route at `/api/favorites/reorder` is the
// canonical new path; this shim is kept for any client still hitting v0.6.
const ReorderInput = z.union([
  z.object({ orderedFavoriteIds: z.array(z.uuid()) }),
  z.object({ orderedPageIds: z.array(z.uuid()) }),
]);

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const body = ReorderInput.parse(await req.json().catch(() => ({})));
    const db = getDb();

    let orderedFavoriteIds: string[];
    if ('orderedFavoriteIds' in body) {
      orderedFavoriteIds = body.orderedFavoriteIds;
    } else {
      // Legacy path: resolve (userId, pageIds) → favorite row ids in the same order.
      const rows = await db
        .select({ id: schema.userPagePrefs.id, pageId: schema.userPagePrefs.pageId })
        .from(schema.userPagePrefs)
        .where(
          and(
            eq(schema.userPagePrefs.userId, ctx.userId),
            eq(schema.userPagePrefs.workspaceId, ctx.workspaceId),
            inArray(schema.userPagePrefs.pageId, body.orderedPageIds),
          ),
        );
      const byPageId = new Map(rows.map((r) => [r.pageId, r.id]));
      orderedFavoriteIds = body.orderedPageIds
        .map((pid) => byPageId.get(pid))
        .filter((id): id is string => id != null);
    }

    await reorderFavorites(db, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      orderedFavoriteIds,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
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
