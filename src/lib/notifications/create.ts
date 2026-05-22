import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { sendNotificationEmail } from '@/lib/email/notify-email';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Fire-and-forget per-event email for freshly inserted notification rows.
 * Uses getDb() (a fresh, post-commit connection) — NOT the caller's tx — so we
 * only email for rows that actually persisted. Mirrors webhooks/dispatch#emit:
 * scheduled off the request path via setImmediate, rejections swallowed.
 */
function scheduleEmails(rows: schema.Notification[]): void {
  for (const n of rows) {
    setImmediate(() => {
      void sendNotificationEmail(getDb(), n).catch(() => {});
    });
  }
}

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
  const rows = await db
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
  scheduleEmails(rows);
  return rows;
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
  const inserted = await db
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
  scheduleEmails(inserted);
  return inserted;
}
