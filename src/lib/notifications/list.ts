import { and, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * P16 will extend this filter shape with `type[]` + `dateFrom`/`dateTo`; P15
 * only honors the `status` slot (used by GET /api/notifications?unreadOnly=true)
 * — keeping the parameter shape stable now means P16 doesn't need a second
 * helper, and the drawer + the /notifications page share one paginated reader.
 */
export type NotificationFilter = {
  type?: string[];
  status?: 'read' | 'unread' | 'all';
  dateFrom?: Date;
  dateTo?: Date;
};

export type ListNotificationsInput = {
  userId: string;
  workspaceId: string;
  /** Default 50; clamped to [1, 100]. */
  limit?: number;
  /** base64url(`${createdAt.toISOString()}|${id}`) — null on first page. */
  cursor?: string | null;
  filter?: NotificationFilter;
};

export type ListNotificationsResult = {
  notifications: schema.Notification[];
  nextCursor: string | null;
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const [iso, id] = decoded.split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function listNotifications(
  db: Db,
  input: ListNotificationsInput,
): Promise<ListNotificationsResult> {
  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;

  const conds: SQL[] = [
    eq(schema.notifications.userId, input.userId),
    eq(schema.notifications.workspaceId, input.workspaceId),
  ];

  // P15 honors `status` only ({ status: 'unread' } from /api/notifications);
  // P16 extends to type/date filters.
  if (input.filter?.status === 'unread') {
    conds.push(isNull(schema.notifications.readAt));
  }

  if (cursor) {
    // Keyset: (createdAt, id) strictly less than (cursor.createdAt, cursor.id)
    // under desc, desc ordering — matches src/lib/audit/query.ts.
    const keyset = or(
      lt(schema.notifications.createdAt, cursor.createdAt),
      and(
        eq(schema.notifications.createdAt, cursor.createdAt),
        lt(schema.notifications.id, cursor.id),
      ),
    );
    if (keyset) conds.push(keyset);
  }

  const rows = await db
    .select()
    .from(schema.notifications)
    .where(and(...conds))
    .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const notifications = hasMore ? rows.slice(0, limit) : rows;
  const last = notifications.at(-1);
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  return { notifications, nextCursor };
}

export type MarkReadInput = { id: string; userId: string; workspaceId: string };
export type MarkAllReadInput = { userId: string; workspaceId: string };

/**
 * Mark a single notification read. The (id, userId, workspaceId) triple
 * enforces cross-tenant isolation: a mismatched user or workspace simply
 * matches zero rows, so the call is safe to expose without further auth.
 * Idempotent on already-read rows (isNull predicate → no-op).
 */
export async function markRead(db: Db, input: MarkReadInput): Promise<{ affected: number }> {
  const result = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.id, input.id),
        eq(schema.notifications.userId, input.userId),
        eq(schema.notifications.workspaceId, input.workspaceId),
        isNull(schema.notifications.readAt),
      ),
    )
    .returning({ id: schema.notifications.id });
  return { affected: result.length };
}

/**
 * Mark every unread notification for (userId, workspaceId) read. One UPDATE,
 * atomic by virtue of being a single statement. Cross-workspace rows for the
 * same user are NOT touched.
 */
export async function markAllRead(db: Db, input: MarkAllReadInput): Promise<{ affected: number }> {
  const result = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.userId, input.userId),
        eq(schema.notifications.workspaceId, input.workspaceId),
        isNull(schema.notifications.readAt),
      ),
    )
    .returning({ id: schema.notifications.id });
  return { affected: result.length };
}
