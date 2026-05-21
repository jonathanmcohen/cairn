import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { extractMentions } from '@/lib/mentions/parse';
import { notifyCommentReply, notifyMentions } from '@/lib/notifications/create';
import { type CommentAnchor, CommentAnchorSchema } from './anchor';

export type CreateCommentInput = {
  workspaceId: string;
  pageId: string;
  authorId: string;
  body: string;
  anchor?: CommentAnchor | null;
};

export type CreateCommentResult = {
  comment: schema.Comment;
  mentionedUserIds: string[];
};

export async function createComment(
  db: PostgresJsDatabase<typeof schema>,
  input: CreateCommentInput,
): Promise<CreateCommentResult> {
  const body = input.body.trim();
  if (!body) throw new Error('comment body is required');
  const anchor = input.anchor == null ? null : CommentAnchorSchema.parse(input.anchor);

  // `extractMentions` is the authoritative source of mentioned ids — run it on
  // the server against the stored body.
  const mentionedUserIds = extractMentions(body);

  const comment = await db.transaction(async (tx) => {
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

    const [inserted] = await tx
      .insert(schema.comments)
      .values({
        workspaceId: input.workspaceId,
        pageId: input.pageId,
        authorId: input.authorId,
        body,
        anchor,
      })
      .returning();
    if (!inserted) throw new Error('failed to insert comment');

    // Fire notification triggers in the same transaction so a notify failure
    // rolls back the comment insert cleanly. notifyCommentReply runs AFTER the
    // insert: its `ne(authorId, actorId)` filter excludes the just-added row.
    await notifyMentions(tx, {
      actorId: input.authorId,
      pageId: input.pageId,
      commentId: inserted.id,
      workspaceId: input.workspaceId,
      mentionedUserIds,
    });
    await notifyCommentReply(tx, {
      actorId: input.authorId,
      pageId: input.pageId,
      commentId: inserted.id,
      workspaceId: input.workspaceId,
    });

    return inserted;
  });

  return { comment, mentionedUserIds };
}
