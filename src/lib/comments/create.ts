import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { type CommentAnchor, CommentAnchorSchema } from './anchor';

export type CreateCommentInput = {
  workspaceId: string;
  pageId: string;
  authorId: string;
  body: string;
  anchor?: CommentAnchor | null;
};

export async function createComment(
  db: PostgresJsDatabase<typeof schema>,
  input: CreateCommentInput,
): Promise<schema.Comment> {
  const body = input.body.trim();
  if (!body) throw new Error('comment body is required');
  const anchor = input.anchor == null ? null : CommentAnchorSchema.parse(input.anchor);

  return db.transaction(async (tx) => {
    const [page] = await tx
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, input.pageId),
          eq(schema.pages.workspaceId, input.workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!page) throw new Error('page is missing or belongs to a different workspace');

    const [comment] = await tx
      .insert(schema.comments)
      .values({
        workspaceId: input.workspaceId,
        pageId: input.pageId,
        authorId: input.authorId,
        body,
        anchor,
      })
      .returning();
    if (!comment) throw new Error('failed to insert comment');
    return comment;
  });
}
