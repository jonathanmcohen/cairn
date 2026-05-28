import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * v0.9.0 G1 P8 — pick a workspace id to attach user-scoped audit events to.
 *
 * Passkey enrollment + admin-policy notifications are user-scoped events that
 * still need to live somewhere in the per-workspace audit log (so admins can
 * see "user X enrolled a passkey" alongside other identity events). We use
 * the user's oldest workspace membership as their "primary" workspace.
 *
 * Returns `null` for users not yet in any workspace (e.g. first-time
 * registration); callers should fall back to a non-audit path in that case.
 */
export async function getPrimaryWorkspaceId(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(asc(schema.workspaceMembers.joinedAt))
    .limit(1);
  return row?.workspaceId ?? null;
}
