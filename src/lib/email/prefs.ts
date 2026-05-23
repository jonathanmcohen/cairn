import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The notification types that can have per-workspace email preferences. */
export const NOTIFICATION_TYPES = ['mention', 'comment_reply'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** A single per-type email preference. Opt-in: both flags default to false. */
export type EmailPref = {
  notificationType: NotificationType;
  emailEnabled: boolean;
  digestOnly: boolean;
};

/**
 * Email prefs for a user in a workspace, one entry per notification type.
 * Stored rows are merged over opt-in defaults (emailEnabled/digestOnly false),
 * so every type is always represented in the result.
 */
export async function getEmailPrefs(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<EmailPref[]> {
  const rows = await db
    .select()
    .from(schema.notificationEmailPrefs)
    .where(
      and(
        eq(schema.notificationEmailPrefs.userId, userId),
        eq(schema.notificationEmailPrefs.workspaceId, workspaceId),
      ),
    );
  const byType = new Map(rows.map((r) => [r.notificationType, r]));
  return NOTIFICATION_TYPES.map((notificationType) => {
    const row = byType.get(notificationType);
    return {
      notificationType,
      emailEnabled: row?.emailEnabled ?? false,
      digestOnly: row?.digestOnly ?? false,
    };
  });
}

/** A single type's pref, merged over the opt-in defaults. */
export async function getEmailPref(
  db: Db,
  userId: string,
  workspaceId: string,
  type: NotificationType,
): Promise<EmailPref> {
  const [row] = await db
    .select()
    .from(schema.notificationEmailPrefs)
    .where(
      and(
        eq(schema.notificationEmailPrefs.userId, userId),
        eq(schema.notificationEmailPrefs.workspaceId, workspaceId),
        eq(schema.notificationEmailPrefs.notificationType, type),
      ),
    )
    .limit(1);
  return {
    notificationType: type,
    emailEnabled: row?.emailEnabled ?? false,
    digestOnly: row?.digestOnly ?? false,
  };
}

/** Upsert a single per-type preference (composite PK = user+workspace+type). */
export async function setEmailPref(
  db: Db,
  input: {
    userId: string;
    workspaceId: string;
    notificationType: NotificationType;
    emailEnabled: boolean;
    digestOnly: boolean;
  },
): Promise<void> {
  await db
    .insert(schema.notificationEmailPrefs)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      notificationType: input.notificationType,
      emailEnabled: input.emailEnabled,
      digestOnly: input.digestOnly,
    })
    .onConflictDoUpdate({
      target: [
        schema.notificationEmailPrefs.userId,
        schema.notificationEmailPrefs.workspaceId,
        schema.notificationEmailPrefs.notificationType,
      ],
      set: { emailEnabled: input.emailEnabled, digestOnly: input.digestOnly },
    });
}
