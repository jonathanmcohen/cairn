import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import type { Notification } from '@/db/schema/notifications';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

// Toggleable email-enabled state + a fake transport whose sendMail we assert on.
let enabled = true;
const sendMail = vi.fn(async (_mail: { to: string }) => ({}));
vi.mock('@/lib/email/transport', () => ({
  emailEnabled: () => enabled,
  getTransport: () => (enabled ? { sendMail } : null),
  fromAddress: () => 'cairn@example.com',
}));

// Stub the digest template so the SSRF-guarded deep links don't reject under
// the localhost test NEXTAUTH_URL. We capture the batch passed in to assert it.
let lastBatch: Notification[] = [];
vi.mock('@/lib/email/templates', () => ({
  renderDigestEmail: async (notifications: Notification[]) => {
    lastBatch = notifications;
    return {
      subject: `${notifications.length} new`,
      text: 'digest',
      html: '<p>digest</p>',
    };
  },
}));

// Imported after the mocks so the module under test binds to the fakes.
const { scanDigests, getWatermark } = await import('@/lib/email/digest');

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE notifications, notification_email_prefs, system_meta, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
  enabled = true;
  sendMail.mockClear();
  lastBatch = [];
});

async function addPref(userId: string, workspaceId: string, digestOnly: boolean): Promise<void> {
  await db.insert(schema.notificationEmailPrefs).values({
    userId,
    workspaceId,
    notificationType: 'mention',
    emailEnabled: true,
    digestOnly,
  });
}

async function addNotification(
  userId: string,
  workspaceId: string,
  createdAt?: Date,
): Promise<Notification> {
  const [n] = await db
    .insert(schema.notifications)
    .values({
      userId,
      workspaceId,
      type: 'mention',
      payload: { pageId: 'p1', commentId: 'c1', actorId: 'a1' },
      ...(createdAt ? { createdAt } : {}),
    })
    .returning();
  if (!n) throw new Error('failed to insert notification');
  return n;
}

describe('scanDigests', () => {
  it('sends one batched email per digest-eligible user with unread notifications', async () => {
    const a = await createTestWorkspaceWithUser(db, { email: 'a@example.com' });
    const b = await createTestWorkspaceWithUser(db, { email: 'b@example.com' });
    await addPref(a.userId, a.workspaceId, true);
    await addPref(b.userId, b.workspaceId, true);
    await addNotification(a.userId, a.workspaceId);
    await addNotification(a.userId, a.workspaceId);
    await addNotification(b.userId, b.workspaceId);

    const sent = await scanDigests(db, new Date());

    expect(sent).toBe(2);
    expect(sendMail).toHaveBeenCalledTimes(2);
    const recipients = sendMail.mock.calls.map((c) => c[0].to).sort();
    expect(recipients).toEqual(['a@example.com', 'b@example.com']);
  });

  it('batches all of a user unread notifications into a single email', async () => {
    const a = await createTestWorkspaceWithUser(db, { email: 'a@example.com' });
    await addPref(a.userId, a.workspaceId, true);
    await addNotification(a.userId, a.workspaceId);
    await addNotification(a.userId, a.workspaceId);
    await addNotification(a.userId, a.workspaceId);

    const sent = await scanDigests(db, new Date());

    expect(sent).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(lastBatch).toHaveLength(3);
  });

  it('is idempotent: an immediate second scan sends nothing and advances the watermark', async () => {
    const a = await createTestWorkspaceWithUser(db, { email: 'a@example.com' });
    await addPref(a.userId, a.workspaceId, true);
    await addNotification(a.userId, a.workspaceId, new Date('2026-01-01T00:00:00.000Z'));

    const now = new Date('2026-01-02T00:00:00.000Z');
    expect(await scanDigests(db, now)).toBe(1);
    expect(await getWatermark(db, a.userId)).toEqual(now);

    sendMail.mockClear();
    expect(await scanDigests(db, new Date(now.getTime() + 1000))).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('picks up a notification created after the first scan on a later scan', async () => {
    const a = await createTestWorkspaceWithUser(db, { email: 'a@example.com' });
    await addPref(a.userId, a.workspaceId, true);
    const first = new Date('2026-01-01T00:00:00.000Z');
    await addNotification(a.userId, a.workspaceId, new Date('2025-12-31T00:00:00.000Z'));

    expect(await scanDigests(db, first)).toBe(1);

    // A notification created after the watermark is included next time.
    await addNotification(a.userId, a.workspaceId, new Date('2026-01-02T00:00:00.000Z'));
    sendMail.mockClear();
    expect(await scanDigests(db, new Date('2026-01-03T00:00:00.000Z'))).toBe(1);
    expect(lastBatch).toHaveLength(1);
  });

  it('returns 0 and sends nothing when email is disabled', async () => {
    const a = await createTestWorkspaceWithUser(db, { email: 'a@example.com' });
    await addPref(a.userId, a.workspaceId, true);
    await addNotification(a.userId, a.workspaceId);

    enabled = false;
    expect(await scanDigests(db, new Date())).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not email a user without any digestOnly pref', async () => {
    const a = await createTestWorkspaceWithUser(db, { email: 'a@example.com' });
    await addPref(a.userId, a.workspaceId, false);
    await addNotification(a.userId, a.workspaceId);

    expect(await scanDigests(db, new Date())).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
