import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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

describe('auth_sessions schema', () => {
  it('inserts and reads a session row with defaults', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [row] = await getDb()
      .insert(schema.authSessions)
      .values({ userId: me.userId, userAgent: 'Mozilla/5.0', ip: '203.0.113.7' })
      .returning();
    expect(row?.id).toBeTruthy();
    expect(row?.userId).toBe(me.userId);
    expect(row?.userAgent).toBe('Mozilla/5.0');
    expect(row?.ip).toBe('203.0.113.7');
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.lastSeenAt).toBeInstanceOf(Date);
    expect(row?.revokedAt).toBeNull();
  });

  it('allows null user_agent/ip and sets revoked_at', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [row] = await getDb()
      .insert(schema.authSessions)
      .values({ userId: me.userId })
      .returning();
    const when = new Date();
    await getDb()
      .update(schema.authSessions)
      .set({ revokedAt: when })
      .where(eq(schema.authSessions.id, row!.id));
    const [after] = await getDb()
      .select()
      .from(schema.authSessions)
      .where(eq(schema.authSessions.id, row!.id));
    expect(after?.userAgent).toBeNull();
    expect(after?.ip).toBeNull();
    expect(after?.revokedAt).toBeInstanceOf(Date);
  });

  it('cascade-deletes rows when the user is deleted', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await getDb().insert(schema.authSessions).values({ userId: me.userId });
    await sql`DELETE FROM users WHERE id = ${me.userId}`;
    const rows = await getDb()
      .select()
      .from(schema.authSessions)
      .where(eq(schema.authSessions.userId, me.userId));
    expect(rows).toHaveLength(0);
  });
});
