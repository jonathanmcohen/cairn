import { and, count, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { listNotifications } from '@/lib/notifications/list';

const Query = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .nullish()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  // Accept either the new keyset cursor (base64url) or the legacy ISO-datetime
  // cursor the v0.3 inline query emitted, so in-flight clients during the P15
  // rollout don't 400. The helper decodes the new shape; if decoding fails we
  // fall through to a `createdAt < cursorIso` legacy interpretation below.
  cursor: z.string().nullish(),
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
    const { notifications, nextCursor } = await listNotifications(db, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      limit,
      cursor: cursor ?? null,
      filter: unreadOnly ? { status: 'unread' } : undefined,
    });

    const [unread] = await db
      .select({ value: count() })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, ctx.userId),
          eq(schema.notifications.workspaceId, ctx.workspaceId),
          isNull(schema.notifications.readAt),
        ),
      );

    return NextResponse.json({
      notifications,
      nextCursor: nextCursor ?? undefined,
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
