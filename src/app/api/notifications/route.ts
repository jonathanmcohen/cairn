import { and, count, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { listNotifications, type NotificationFilter } from '@/lib/notifications/list';

// Mirror the type enum from src/db/schema/notifications.ts. (P16 surfaces only
// the comment-side types in the page UI for now; reminders are out-of-band.)
const NotificationTypeSchema = z.enum(['mention', 'comment_reply', 'reminder']);
const StatusSchema = z.enum(['read', 'unread', 'all']);

const Query = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .nullish()
    .transform((v) => v === 'true'),
  status: StatusSchema.optional(),
  type: z.array(NotificationTypeSchema).optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
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
    const typeParams = url.searchParams.getAll('type');
    const parsed = Query.parse({
      unreadOnly: url.searchParams.get('unreadOnly'),
      status: url.searchParams.get('status') ?? undefined,
      // type is repeatable: ?type=mention&type=comment_reply
      type: typeParams.length > 0 ? typeParams : undefined,
      dateFrom: url.searchParams.get('dateFrom') ?? undefined,
      dateTo: url.searchParams.get('dateTo') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor'),
    });

    // Compose the filter. Back-compat: `unreadOnly=true` keeps producing an
    // unread-only feed for callers from the v0.3/P15 era. When both are set
    // `status=` wins so the new page UI can override the drawer-style default.
    const filter: NotificationFilter = {
      type: parsed.type,
      status: parsed.status ?? (parsed.unreadOnly ? 'unread' : undefined),
      dateFrom: parsed.dateFrom ? new Date(parsed.dateFrom) : undefined,
      dateTo: parsed.dateTo ? new Date(parsed.dateTo) : undefined,
    };

    const db = getDb();
    const { notifications, nextCursor } = await listNotifications(db, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      limit: parsed.limit,
      cursor: parsed.cursor ?? null,
      filter,
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
