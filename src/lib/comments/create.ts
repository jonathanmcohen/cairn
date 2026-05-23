import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { extractMentions } from '@/lib/mentions/parse';
import { notifyCommentReply, notifyMentions } from '@/lib/notifications/create';
import { emit } from '@/lib/webhooks/dispatch';
import { type CommentAnchor, CommentAnchorSchema } from './anchor';
import { type CommentTarget, CommentTargetSchema, resolveTarget } from './target';

export type CreateCommentInput = {
  workspaceId: string;
  authorId: string;
  body: string;
  target: CommentTarget;
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

  const target = CommentTargetSchema.parse(input.target);
  const anchor = input.anchor == null ? null : CommentAnchorSchema.parse(input.anchor);
  // Anchors only make sense against a page's prose; reject them for db_row/file.
  if (anchor !== null && target.type !== 'page') {
    throw new Error('anchor is only supported on page comments');
  }

  // `extractMentions` is the authoritative source of mentioned ids — run it on
  // the server against the stored body.
  const mentionedUserIds = extractMentions(body);

  const comment = await db.transaction(async (tx) => {
    const resolved = await resolveTarget(tx, input.workspaceId, target);

    const [inserted] = await tx
      .insert(schema.comments)
      .values({
        workspaceId: input.workspaceId,
        pageId: resolved.pageId,
        targetType: resolved.type,
        targetId: resolved.id,
        authorId: input.authorId,
        body,
        anchor,
      })
      .returning();
    if (!inserted) throw new Error('failed to insert comment');

    // Fire notification triggers in the same transaction so a notify failure
    // rolls back the comment insert cleanly. Mentions fan out for every target
    // type; the reply notification only applies when there is an owning page
    // (notifyCommentReply scans prior authors on that page).
    await notifyMentions(tx, {
      actorId: input.authorId,
      pageId: resolved.pageId ?? resolved.id,
      commentId: inserted.id,
      workspaceId: input.workspaceId,
      mentionedUserIds,
    });
    if (resolved.pageId) {
      await notifyCommentReply(tx, {
        actorId: input.authorId,
        pageId: resolved.pageId,
        commentId: inserted.id,
        workspaceId: input.workspaceId,
      });
    }

    return inserted;
  });

  // Off the mutation path; never awaited (emit guards its own failures).
  void emit('comment.created', input.workspaceId, {
    id: comment.id,
    targetType: comment.targetType,
    targetId: comment.targetId,
    pageId: comment.pageId,
  });

  return { comment, mentionedUserIds };
}
