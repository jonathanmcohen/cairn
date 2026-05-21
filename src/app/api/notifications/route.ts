import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';

const Query = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .nullish()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().datetime().nullish(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const url = new URL(req.url);
    const { unreadOnly, limit, cursor } = Query.parse({
      unreadOnly: url.searchParams.get('unreadOnly'),
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor'),
    });

    const db = getDb();
    const scope = and(
      eq(schema.notifications.userId, ctx.userId),
      eq(schema.notifications.workspaceId, ctx.workspaceId),
    );
    const where = and(
      scope,
      unreadOnly ? isNull(schema.notifications.readAt) : undefined,
      cursor ? lt(schema.notifications.createdAt, new Date(cursor)) : undefined,
    );

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(where)
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const notifications = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? (notifications.at(-1)?.createdAt.toISOString() ?? undefined)
      : undefined;

    const [unread] = await db
      .select({ value: count() })
      .from(schema.notifications)
      .where(and(scope, isNull(schema.notifications.readAt)));

    return NextResponse.json({
      notifications,
      nextCursor,
      unreadCount: unread?.value ?? 0,
    });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    {
      status: 500,
    },
  );
}
