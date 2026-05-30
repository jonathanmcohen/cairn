import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import {
  createSession,
  isSessionActive,
  listActiveSessions,
  revokeAllSessions,
  touchSession,
} from '@/lib/auth/session-store';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE auth_sessions, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

describe('session-store', () => {
  it('createSession returns a uuid sid and persists a row', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const sid = await createSession(getDb(), {
      userId: me.userId,
      userAgent: 'UA/1',
      ip: '198.51.100.4',
    });
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    const sessions = await listActiveSessions(getDb(), me.userId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(sid);
    expect(sessions[0]?.userAgent).toBe('UA/1');
    expect(sessions[0]?.ip).toBe('198.51.100.4');
  });

  it('isSessionActive: true for fresh, false for revoked/unknown', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const sid = await createSession(getDb(), { userId: me.userId });
    expect(await isSessionActive(getDb(), me.userId, sid)).toBe(true);
    expect(await isSessionActive(getDb(), me.userId, crypto.randomUUID())).toBe(false);
    // wrong user owning a real sid must NOT be active
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    expect(await isSessionActive(getDb(), other.userId, sid)).toBe(false);
  });

  it('touchSession advances last_seen_at', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const sid = await createSession(getDb(), { userId: me.userId });
    await sql`UPDATE auth_sessions SET last_seen_at = now() - interval '1 hour' WHERE id = ${sid}`;
    const before = (await listActiveSessions(getDb(), me.userId))[0]?.lastSeenAt;
    await touchSession(getDb(), sid);
    const after = (await listActiveSessions(getDb(), me.userId))[0]?.lastSeenAt;
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it('revokeAllSessions(except current) revokes others, keeps current', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const current = await createSession(getDb(), { userId: me.userId, userAgent: 'this' });
    await createSession(getDb(), { userId: me.userId, userAgent: 'phone' });
    await createSession(getDb(), { userId: me.userId, userAgent: 'tablet' });
    const revoked = await revokeAllSessions(getDb(), me.userId, { exceptSid: current });
    expect(revoked).toBe(2);
    const active = await listActiveSessions(getDb(), me.userId);
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(current);
  });

  it('revokeAllSessions(all) revokes every session including current', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await createSession(getDb(), { userId: me.userId });
    await createSession(getDb(), { userId: me.userId });
    const revoked = await revokeAllSessions(getDb(), me.userId, {});
    expect(revoked).toBe(2);
    expect(await listActiveSessions(getDb(), me.userId)).toHaveLength(0);
  });
});
