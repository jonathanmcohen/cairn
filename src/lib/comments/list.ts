import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { CommentTarget } from './target';

/** Page comments for a page (v0.3.0 signature; now filters target_type='page'). */
export async function listComments(
  db: PostgresJsDatabase<typeof schema>,
  pageId: string,
  workspaceId: string,
): Promise<schema.Comment[]> {
  return db
    .select()
    .from(schema.comments)
    .where(
      and(
        eq(schema.comments.targetType, 'page'),
        eq(schema.comments.targetId, pageId),
        eq(schema.comments.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(schema.comments.createdAt));
}

/** Comments for any polymorphic target, workspace-scoped, oldest first. */
export async function listCommentsByTarget(
  db: PostgresJsDatabase<typeof schema>,
  target: CommentTarget,
  workspaceId: string,
): Promise<schema.Comment[]> {
  return db
    .select()
    .from(schema.comments)
    .where(
      and(
        eq(schema.comments.targetType, target.type),
        eq(schema.comments.targetId, target.id),
        eq(schema.comments.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(schema.comments.createdAt));
}
