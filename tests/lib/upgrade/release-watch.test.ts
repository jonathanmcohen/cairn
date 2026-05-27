/**
 * v0.9.0 G8 P42 — release-watch tick tests.
 *
 * Verifies fan-out to admin/owner workspace members, per-version idempotency,
 * no-op on equal/older latest, and clean feed-failure path.
 */
import { eq, sql as sqlOp } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { runReleaseWatchTick } from '@/lib/upgrade/release-watch';
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
  await sql`TRUNCATE notifications, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

describe('runReleaseWatchTick', () => {
  it('inserts one notification per admin/owner across every workspace', async () => {
    const ws1Owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    // Same workspace, add an extra admin + an editor.
    const [admin] = await db
      .insert(schema.users)
      .values({ email: 'a@e.com', passwordHash: 'h', name: 'admin' })
      .returning();
    const [editor] = await db
      .insert(schema.users)
      .values({ email: 'e@e.com', passwordHash: 'h', name: 'editor' })
      .returning();
    if (!admin || !editor) throw new Error('failed to seed users');
    await db.insert(schema.workspaceMembers).values([
      { workspaceId: ws1Owner.workspaceId, userId: admin.id, role: 'admin' },
      { workspaceId: ws1Owner.workspaceId, userId: editor.id, role: 'editor' },
    ]);

    // Separate workspace with its own owner.
    await createTestWorkspaceWithUser(db, { role: 'owner' });

    const result = await runReleaseWatchTick({
      db,
      currentVersion: '0.8.0',
      fetchFeed: async () => ({
        ok: true,
        latestTag: '0.9.0',
        releaseNotesUrl: 'https://github.com/x/y/releases/tag/v0.9.0',
      }),
    });

    // owner ws1 + admin ws1 + owner ws2 = 3 notifications. Editor is excluded.
    expect(result.notificationsCreated).toBe(3);
    expect(result.latestTag).toBe('0.9.0');

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.type, 'upgrade_available'));
    expect(rows).toHaveLength(3);
    const payloads = rows
      .map((r) => r.payload as { version: string; releaseNotesUrl: string })
      .map((p) => p.version);
    expect(new Set(payloads)).toEqual(new Set(['0.9.0']));
  });

  it('is idempotent per-version (rerun = 0 new rows)', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const fetchFeed = async (): Promise<{
      ok: true;
      latestTag: string;
      releaseNotesUrl: string;
    }> => ({ ok: true, latestTag: '0.9.0', releaseNotesUrl: 'x' });

    const first = await runReleaseWatchTick({ db, currentVersion: '0.8.0', fetchFeed });
    const second = await runReleaseWatchTick({ db, currentVersion: '0.8.0', fetchFeed });
    expect(first.notificationsCreated).toBe(1);
    expect(second.notificationsCreated).toBe(0);
    expect(owner.workspaceId).toBeTruthy();
  });

  it('emits a new row when the available version advances', async () => {
    await createTestWorkspaceWithUser(db, { role: 'owner' });
    const first = await runReleaseWatchTick({
      db,
      currentVersion: '0.8.0',
      fetchFeed: async () => ({ ok: true, latestTag: '0.9.0', releaseNotesUrl: 'x' }),
    });
    const second = await runReleaseWatchTick({
      db,
      currentVersion: '0.8.0',
      fetchFeed: async () => ({ ok: true, latestTag: '0.9.1', releaseNotesUrl: 'y' }),
    });
    expect(first.notificationsCreated).toBe(1);
    expect(second.notificationsCreated).toBe(1);
    const counts = (await db.execute(
      sqlOp`SELECT count(*)::int AS c FROM notifications WHERE type = 'upgrade_available'`,
    )) as unknown as Array<{ c: number }>;
    expect(counts[0]?.c).toBe(2);
  });

  it('does nothing when current = latest', async () => {
    await createTestWorkspaceWithUser(db, { role: 'owner' });
    const result = await runReleaseWatchTick({
      db,
      currentVersion: '0.9.0',
      fetchFeed: async () => ({ ok: true, latestTag: '0.9.0', releaseNotesUrl: 'x' }),
    });
    expect(result.notificationsCreated).toBe(0);
  });

  it('records failure metadata and exits clean when feed fetch fails', async () => {
    const result = await runReleaseWatchTick({
      db,
      currentVersion: '0.9.0',
      fetchFeed: async () => ({ ok: false, reason: 'rate limited' }),
    });
    expect(result.notificationsCreated).toBe(0);
    expect(result.feedError).toBe('rate limited');
  });
});
