import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * The notification types that can have per-workspace, per-type email
 * preferences. This is intentionally a SUBSET of `notifications.type` (which
 * also has `reminder`, `flashcards_due`, `upgrade_available`).
 *
 * #72 decision — only the types whose per-event send path actually consults
 * the per-type pref belong here:
 *   - `mention`, `comment_reply` — created via `notifications/create.ts`, which
 *     fires `sendNotificationEmail()` → reads `getEmailPref(...)` per type.
 *     KEEP (real per-type pref).
 *   - `reminder` (reminders/scan.ts) and `flashcards_due` (flashcards/notify-due.ts)
 *     insert notification rows DIRECTLY, bypassing `sendNotificationEmail`, so a
 *     per-type email toggle would be a dead control. They only surface over email
 *     via the daily digest, which is gated by the user-level `digestOnly` flag,
 *     not a per-type pref. OMIT (no per-type email pathway).
 *   - `upgrade_available` — admin/release-watch notification targeting owners via
 *     a different path. OMIT from per-user email prefs.
 *   - `page_approval`, `page_status`, `page_lock` (v0.9.9 Plan I #195) — created
 *     via `notifications/create.ts` (notifyApprovalDecision / notifyStatusChange /
 *     notifyPageLock), which route through `scheduleEmails` → `sendNotificationEmail`
 *     → `getEmailPref`, so they DO consult the per-type pref. KEEP.
 * Exposing only the emailable subset avoids showing unwired toggles.
 */
export const NOTIFICATION_TYPES = [
  'mention',
  'comment_reply',
  'page_approval',
  'page_status',
  'page_lock',
] as const;
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
