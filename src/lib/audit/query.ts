import { and, desc, eq, gte, lt, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { AuditAction, AuditTargetType } from './actions';

type Db = PostgresJsDatabase<typeof schema>;

export type AuditFilters = {
  action?: AuditAction;
  actorId?: string;
  targetType?: AuditTargetType | string;
  targetId?: string;
  /** Inclusive lower bound (createdAt >= from). */
  from?: Date;
  /** Exclusive upper bound (createdAt < to). */
  to?: Date;
};

export type AuditListInput = {
  workspaceId: string;
  filters?: AuditFilters;
  limit?: number;
  cursor?: string;
};

export type AuditListResult = {
  entries: (typeof schema.auditLog.$inferSelect)[];
  nextCursor: string | null;
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/** Cursor format: base64url(`<createdAtIso>|<id>`) — keyset pagination. */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}
function decodeCursor(c: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(c, 'base64url').toString('utf8');
    const [iso, id] = raw.split('|');
    if (!iso || !id) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return { createdAt: d, id };
  } catch {
    return null;
  }
}

export async function listAuditLog(db: Db, input: AuditListInput): Promise<AuditListResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT));
  const f = input.filters ?? {};
  const conds: SQL[] = [eq(schema.auditLog.workspaceId, input.workspaceId)];
  if (f.action) conds.push(eq(schema.auditLog.action, f.action));
  if (f.actorId) conds.push(eq(schema.auditLog.actorUserId, f.actorId));
  if (f.targetType) conds.push(eq(schema.auditLog.targetType, f.targetType));
  if (f.targetId) conds.push(eq(schema.auditLog.targetId, f.targetId));
  if (f.from) conds.push(gte(schema.auditLog.createdAt, f.from));
  if (f.to) conds.push(lt(schema.auditLog.createdAt, f.to));
  if (input.cursor) {
    const cur = decodeCursor(input.cursor);
    if (cur) {
      // keyset: (createdAt, id) strictly less than (cursor.createdAt, cursor.id) under desc, desc.
      const keyset = or(
        lt(schema.auditLog.createdAt, cur.createdAt),
        and(eq(schema.auditLog.createdAt, cur.createdAt), lt(schema.auditLog.id, cur.id)),
      );
      if (keyset) conds.push(keyset);
    }
  }
  const where = and(...conds);
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(where)
    .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  const last = entries[entries.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last) : null;
  return { entries, nextCursor };
}

export async function listPageActivity(
  db: Db,
  input: { workspaceId: string; pageId: string; limit?: number; cursor?: string },
): Promise<AuditListResult> {
  return listAuditLog(db, {
    workspaceId: input.workspaceId,
    filters: { targetType: 'page', targetId: input.pageId },
    limit: input.limit,
    cursor: input.cursor,
  });
}
