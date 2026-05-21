import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Scope = { commentId: string; workspaceId: string };

async function setResolved(
  db: PostgresJsDatabase<typeof schema>,
  scope: Scope,
  resolvedAt: Date | null,
): Promise<schema.Comment> {
  const [updated] = await db
    .update(schema.comments)
    .set({ resolvedAt, updatedAt: new Date() })
    .where(
      and(
        eq(schema.comments.id, scope.commentId),
        eq(schema.comments.workspaceId, scope.workspaceId),
      ),
    )
    .returning();
  if (!updated) throw new Error('comment not found');
  return updated;
}

export function resolveComment(
  db: PostgresJsDatabase<typeof schema>,
  scope: Scope,
): Promise<schema.Comment> {
  return setResolved(db, scope, new Date());
}

export function reopenComment(
  db: PostgresJsDatabase<typeof schema>,
  scope: Scope,
): Promise<schema.Comment> {
  return setResolved(db, scope, null);
}
