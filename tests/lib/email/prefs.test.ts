import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { getEmailPref, getEmailPrefs, NOTIFICATION_TYPES, setEmailPref } from '@/lib/email/prefs';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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
  await sql`TRUNCATE notification_email_prefs, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('NOTIFICATION_TYPES (#72: emailable subset)', () => {
  it('is exactly the per-type-emailable subset, excluding reminder/flashcards_due/upgrade_available', () => {
    // v0.9.9 Plan I (#195) added page_approval / page_status / page_lock — they
    // route through scheduleEmails → sendNotificationEmail → getEmailPref, so
    // they ARE emailable and belong in this tuple.
    expect([...NOTIFICATION_TYPES].sort()).toEqual([
      'comment_reply',
      'mention',
      'page_approval',
      'page_lock',
      'page_status',
    ]);
    const list = NOTIFICATION_TYPES as readonly string[];
    expect(list).not.toContain('reminder');
    expect(list).not.toContain('flashcards_due');
    expect(list).not.toContain('upgrade_available');
  });
});

describe('getEmailPrefs', () => {
  it('returns the full type list with opt-in defaults when no rows exist', async () => {
    const { userId, workspaceId } = await createTestWorkspaceWithUser(db);
    const prefs = await getEmailPrefs(db, userId, workspaceId);

    expect(prefs.map((p) => p.notificationType).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    for (const p of prefs) {
      expect(p.emailEnabled).toBe(false);
      expect(p.digestOnly).toBe(false);
    }
  });
});

describe('setEmailPref + getEmailPref', () => {
  it('reflects a set pref', async () => {
    const { userId, workspaceId } = await createTestWorkspaceWithUser(db);
    await setEmailPref(db, {
      userId,
      workspaceId,
      notificationType: 'mention',
      emailEnabled: true,
      digestOnly: false,
    });

    const pref = await getEmailPref(db, userId, workspaceId, 'mention');
    expect(pref.emailEnabled).toBe(true);
    expect(pref.digestOnly).toBe(false);

    // Other types remain at default.
    const reply = await getEmailPref(db, userId, workspaceId, 'comment_reply');
    expect(reply.emailEnabled).toBe(false);
  });

  it('upserts: a second set on the same key updates rather than duplicates', async () => {
    const { userId, workspaceId } = await createTestWorkspaceWithUser(db);
    await setEmailPref(db, {
      userId,
      workspaceId,
      notificationType: 'mention',
      emailEnabled: true,
      digestOnly: false,
    });
    await setEmailPref(db, {
      userId,
      workspaceId,
      notificationType: 'mention',
      emailEnabled: false,
      digestOnly: true,
    });

    const rows = await db
      .select()
      .from(schema.notificationEmailPrefs)
      .where(
        and(
          eq(schema.notificationEmailPrefs.userId, userId),
          eq(schema.notificationEmailPrefs.workspaceId, workspaceId),
          eq(schema.notificationEmailPrefs.notificationType, 'mention'),
        ),
      );
    expect(rows).toHaveLength(1);

    const pref = await getEmailPref(db, userId, workspaceId, 'mention');
    expect(pref.emailEnabled).toBe(false);
    expect(pref.digestOnly).toBe(true);
  });

  it('round-trips digestOnly', async () => {
    const { userId, workspaceId } = await createTestWorkspaceWithUser(db);
    await setEmailPref(db, {
      userId,
      workspaceId,
      notificationType: 'comment_reply',
      emailEnabled: true,
      digestOnly: true,
    });

    const pref = await getEmailPref(db, userId, workspaceId, 'comment_reply');
    expect(pref.emailEnabled).toBe(true);
    expect(pref.digestOnly).toBe(true);

    const all = await getEmailPrefs(db, userId, workspaceId);
    const reply = all.find((p) => p.notificationType === 'comment_reply');
    expect(reply?.digestOnly).toBe(true);
  });
});
