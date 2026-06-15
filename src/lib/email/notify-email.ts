import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { Notification } from '@/db/schema/notifications';
import { getEmailPref, type NotificationType } from './prefs';
import { renderNotificationEmail } from './templates';
import { emailEnabled, fromAddress, getTransport } from './transport';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Per-event decide-to-send hook. Sends a single notification email iff:
 * email is configured, the recipient's per-type pref opts in (emailEnabled &&
 * !digestOnly), the recipient has an email, and a transport exists. Returns
 * true only when a message was handed to the transport.
 *
 * NEVER throws — every failure path is caught and logged so callers can fire
 * this and forget it. Returns false on any miss or error.
 */
export async function sendNotificationEmail(db: Db, n: Notification): Promise<boolean> {
  try {
    if (!(await emailEnabled(db))) return false;

    const pref = await getEmailPref(db, n.userId, n.workspaceId, n.type as NotificationType);
    if (!pref.emailEnabled || pref.digestOnly) return false;

    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, n.userId))
      .limit(1);
    if (!user?.email) return false;

    const transport = await getTransport(db);
    if (!transport) return false;

    const { subject, text, html } = await renderNotificationEmail(n);
    await transport.sendMail({ from: await fromAddress(db), to: user.email, subject, text, html });
    return true;
  } catch (err) {
    console.error('[email] sendNotificationEmail failed', err);
    return false;
  }
}
