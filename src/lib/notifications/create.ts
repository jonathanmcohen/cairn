import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export async function notifyMentions(
  db: Db,
  input: {
    actorId: string;
    pageId: string;
    commentId: string;
    workspaceId: string;
    mentionedUserIds: string[] | undefined;
  },
): Promise<schema.Notification[]> {
  const targets = [...new Set(input.mentionedUserIds ?? [])].filter((id) => id !== input.actorId);
  if (targets.length === 0) return [];
  return db
    .insert(schema.notifications)
    .values(
      targets.map((userId) => ({
        userId,
        workspaceId: input.workspaceId,
        type: 'mention' as const,
        payload: { pageId: input.pageId, commentId: input.commentId, actorId: input.actorId },
      })),
    )
    .returning();
}

export async function notifyCommentReply(
  db: Db,
  input: { actorId: string; pageId: string; commentId: string; workspaceId: string },
): Promise<schema.Notification[]> {
  // Prior distinct comment authors on this page, excluding the actor.
  const rows = await db
    .selectDistinct({ authorId: schema.comments.authorId })
    .from(schema.comments)
    .where(
      and(eq(schema.comments.pageId, input.pageId), ne(schema.comments.authorId, input.actorId)),
    );
  const targets = [...new Set(rows.map((r) => r.authorId))];
  if (targets.length === 0) return [];
  return db
    .insert(schema.notifications)
    .values(
      targets.map((userId) => ({
        userId,
        workspaceId: input.workspaceId,
        type: 'comment_reply' as const,
        payload: { pageId: input.pageId, commentId: input.commentId, actorId: input.actorId },
      })),
    )
    .returning();
}
