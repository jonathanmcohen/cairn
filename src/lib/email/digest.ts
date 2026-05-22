import { and, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { Notification } from '@/db/schema/notifications';
import { renderDigestEmail } from './templates';
import { emailEnabled, fromAddress, getTransport } from './transport';

type Db = PostgresJsDatabase<typeof schema>;

/** Build the per-user system_meta watermark key. */
function watermarkKey(userId: string): string {
  return `email_digest_sent_at:${userId}`;
}

/**
 * Read the last digest-sent timestamp for a user, or null if never sent.
 * Stored as an ISO string in `system_meta.value`.
 */
export async function getWatermark(db: Db, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ value: schema.systemMeta.value })
    .from(schema.systemMeta)
    .where(eq(schema.systemMeta.key, watermarkKey(userId)))
    .limit(1);
  if (!row?.value) return null;
  const ts = new Date(row.value);
  return Number.isNaN(ts.getTime()) ? null : ts;
}

/** Upsert the per-user digest watermark to `now` (also bumps updated_at). */
export async function setWatermark(db: Db, userId: string, now: Date): Promise<void> {
  const value = now.toISOString();
  await db
    .insert(schema.systemMeta)
    .values({ key: watermarkKey(userId), value, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.systemMeta.key,
      set: { value, updatedAt: now },
    });
}

/**
 * Batch every digest-eligible user's unread notifications into one email each.
 *
 * Idempotent via a per-user watermark in `system_meta`: each scan only
 * considers notifications created after the user's last successful digest, and
 * advances the watermark to `now` once an email is sent. A user is eligible iff
 * they have at least one `digestOnly:true` email pref.
 *
 * No-ops (returns 0) when email is disabled. Per-user failures are caught and
 * logged so one bad recipient never aborts the whole scan. Returns the number
 * of digest emails handed to the transport.
 */
export async function scanDigests(db: Db, now: Date = new Date()): Promise<number> {
  if (!emailEnabled()) return 0;
  const transport = getTransport();
  if (!transport) return 0;

  const eligible = await db
    .selectDistinct({ userId: schema.notificationEmailPrefs.userId })
    .from(schema.notificationEmailPrefs)
    .where(eq(schema.notificationEmailPrefs.digestOnly, true));

  let sent = 0;
  for (const { userId } of eligible) {
    try {
      const watermark = await getWatermark(db, userId);
      const conditions = [
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
      ];
      if (watermark) conditions.push(gt(schema.notifications.createdAt, watermark));

      const unread: Notification[] = await db
        .select()
        .from(schema.notifications)
        .where(and(...conditions));
      if (unread.length === 0) continue;

      const [user] = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!user?.email) continue;

      const { subject, text, html } = await renderDigestEmail(unread);
      await transport.sendMail({ from: fromAddress(), to: user.email, subject, text, html });
      await setWatermark(db, userId, now);
      sent += 1;
    } catch (err) {
      console.error('[email] scanDigests failed for user', userId, err);
    }
  }
  return sent;
}
