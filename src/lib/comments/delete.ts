import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { HttpError, hasMinRole, type MemberRole } from '@/lib/auth/require-role';

export type DeleteCommentInput = {
  commentId: string;
  workspaceId: string;
  actorId: string;
  actorRole: MemberRole;
};

export async function deleteComment(
  db: PostgresJsDatabase<typeof schema>,
  input: DeleteCommentInput,
): Promise<void> {
  const [comment] = await db
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
  if (!comment) throw new HttpError(404, 'Comment not found');

  const isAuthor = comment.authorId === input.actorId;
  const isAdmin = hasMinRole(input.actorRole, 'admin');
  if (!isAuthor && !isAdmin) {
    throw new HttpError(403, 'Only the author or an admin can delete this comment');
  }

  await db
    .delete(schema.comments)
    .where(
      and(
        eq(schema.comments.id, input.commentId),
        eq(schema.comments.workspaceId, input.workspaceId),
      ),
    );
}
