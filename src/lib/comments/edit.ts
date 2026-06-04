import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { HttpError, type MemberRole } from '@/lib/auth/require-role';

export type EditCommentInput = {
  commentId: string;
  workspaceId: string;
  actorId: string;
  actorRole: MemberRole;
  body: string;
};

export async function editComment(
  db: PostgresJsDatabase<typeof schema>,
  input: EditCommentInput,
): Promise<schema.Comment> {
  const body = input.body.trim();
  if (!body) throw new Error('comment body is required');

  const [existing] = await db
    .select({ id: schema.comments.id, authorId: schema.comments.authorId })
    .from(schema.comments)
    .where(
      and(
        eq(schema.comments.id, input.commentId),
        eq(schema.comments.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  // Same status as not-found to avoid leaking comment existence across workspaces.
  if (!existing) throw new HttpError(404, 'Comment not found');
  // Edit is author-only on purpose: admins may delete a comment but must not
  // silently rewrite another member's words (audit #74/#255).
  if (existing.authorId !== input.actorId) {
    throw new HttpError(403, 'Only the author can edit this comment');
  }

  const [updated] = await db
    .update(schema.comments)
    // Use the DB clock (same source as created_at) so updated_at can never
    // appear earlier than created_at under host↔container clock skew.
    .set({ body, updatedAt: sql`now()` })
    .where(
      and(
        eq(schema.comments.id, input.commentId),
        eq(schema.comments.workspaceId, input.workspaceId),
      ),
    )
    .returning();
  if (!updated) throw new HttpError(404, 'Comment not found');
  return updated;
}
