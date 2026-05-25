import { and, count, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';

/**
 * GET /api/notifications/unread-count
 *
 * Returns `{ unreadCount }` scoped to the caller's active workspace. Pure
 * `count()` query — no row payloads — so the bell can poll cheaply every 30s
 * without dragging the full feed across the wire.
 */
export async function GET(_req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const db = getDb();
    const [row] = await db
      .select({ value: count() })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, ctx.userId),
          eq(schema.notifications.workspaceId, ctx.workspaceId),
          isNull(schema.notifications.readAt),
        ),
      );
    return NextResponse.json({ unreadCount: row?.value ?? 0 });
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
