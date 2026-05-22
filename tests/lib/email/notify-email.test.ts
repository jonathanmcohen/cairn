import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import type { Notification } from '@/db/schema/notifications';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

// Toggleable transport mock: emailEnabled() follows the fake transport.
const sendMail = vi.fn();
let transport: { sendMail: typeof sendMail } | null = { sendMail };

vi.mock('@/lib/email/transport', () => ({
  getTransport: () => transport,
  emailEnabled: () => transport !== null,
  fromAddress: () => 'cairn@example.com',
}));

// Avoid SSRF/NEXTAUTH_URL coupling — focus on the decide-to-send logic.
vi.mock('@/lib/email/templates', () => ({
  renderNotificationEmail: vi.fn(async () => ({
    subject: 'subj',
    text: 'body',
    html: '<p>body</p>',
  })),
}));

import { sendNotificationEmail } from '@/lib/email/notify-email';
import { setEmailPref } from '@/lib/email/prefs';

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
  await sql`TRUNCATE notification_email_prefs, notifications, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: 'x' });
  transport = { sendMail };
});

async function seed(opts: {
  emailEnabled: boolean;
  digestOnly: boolean;
}): Promise<{ db: typeof db; n: Notification }> {
  const { userId, workspaceId } = await createTestWorkspaceWithUser(db);
  await setEmailPref(db, {
    userId,
    workspaceId,
    notificationType: 'mention',
    emailEnabled: opts.emailEnabled,
    digestOnly: opts.digestOnly,
  });
  const n: Notification = {
    id: crypto.randomUUID(),
    userId,
    workspaceId,
    type: 'mention',
    payload: { pageId: crypto.randomUUID(), commentId: crypto.randomUUID(), actorId: userId },
    readAt: null,
    createdAt: new Date(),
  };
  return { db, n };
}

describe('sendNotificationEmail', () => {
  it('sends one email when enabled and pref opts in', async () => {
    const { n } = await seed({ emailEnabled: true, digestOnly: false });
    const sent = await sendNotificationEmail(db, n);
    expect(sent).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0]?.[0];
    expect(arg.to).toContain('@');
    expect(arg.from).toBe('cairn@example.com');
  });

  it('does not send when email is globally disabled', async () => {
    const { n } = await seed({ emailEnabled: true, digestOnly: false });
    transport = null; // emailEnabled() → false
    const sent = await sendNotificationEmail(db, n);
    expect(sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not send when the pref has emailEnabled false', async () => {
    const { n } = await seed({ emailEnabled: false, digestOnly: false });
    const sent = await sendNotificationEmail(db, n);
    expect(sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not send when the pref is digestOnly', async () => {
    const { n } = await seed({ emailEnabled: true, digestOnly: true });
    const sent = await sendNotificationEmail(db, n);
    expect(sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not send (and does not throw) when the recipient has no email', async () => {
    // Seed a real user with an opt-in pref, then blank their email so the
    // recipient-email guard fires (email is NOT NULL, but empty string is
    // falsy → treated as "no email").
    const { userId, workspaceId } = await createTestWorkspaceWithUser(db);
    await setEmailPref(db, {
      userId,
      workspaceId,
      notificationType: 'mention',
      emailEnabled: true,
      digestOnly: false,
    });
    await db.update(schema.users).set({ email: '' }).where(eq(schema.users.id, userId));
    const n: Notification = {
      id: crypto.randomUUID(),
      userId,
      workspaceId,
      type: 'mention',
      payload: { pageId: crypto.randomUUID(), commentId: crypto.randomUUID(), actorId: userId },
      readAt: null,
      createdAt: new Date(),
    };
    const sent = await sendNotificationEmail(db, n);
    expect(sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never throws and returns false when sendMail rejects', async () => {
    const { n } = await seed({ emailEnabled: true, digestOnly: false });
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const sent = await sendNotificationEmail(db, n);
    expect(sent).toBe(false);
  });
});
