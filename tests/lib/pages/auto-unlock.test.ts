/**
 * v0.9.0 G2 P14 — Tests for `runAutoUnlockSweep`.
 *
 * The sweep clears `pages` rows whose `locked_until` has passed, emitting one
 * `page.auto_unlocked` audit row per cleared page. Rows with NULL
 * `locked_until` (manual-unlock-only) and future-`locked_until` rows are left
 * untouched.
 */
import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { runAutoUnlockSweep } from '@/lib/pages/auto-unlock';
import { createPage } from '@/lib/pages/create';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log RESTART IDENTITY CASCADE`;
});

async function seedLockedPage(opts: {
  lockedAtOffsetMs: number;
  lockedUntilOffsetMs: number | null;
}): Promise<{ workspaceId: string; userId: string; pageId: string }> {
  const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
  const page = await createPage(db, {
    workspaceId: ws.workspaceId,
    createdBy: ws.userId,
    title: 't',
  });

  const lockedAt = new Date(Date.now() + opts.lockedAtOffsetMs);
  const lockedUntil =
    opts.lockedUntilOffsetMs === null ? null : new Date(Date.now() + opts.lockedUntilOffsetMs);
  await db
    .update(schema.pages)
    .set({ lockedAt, lockedBy: ws.userId, lockedUntil })
    .where(eq(schema.pages.id, page.id));

  return { workspaceId: ws.workspaceId, userId: ws.userId, pageId: page.id };
}

describe('runAutoUnlockSweep', () => {
  it('clears the lock columns and emits page.auto_unlocked for an expired row', async () => {
    const s = await seedLockedPage({
      lockedAtOffsetMs: -60 * 60 * 1000,
      lockedUntilOffsetMs: -5 * 60 * 1000,
    });
    const result = await runAutoUnlockSweep(db);
    expect(result.unlockedCount).toBe(1);

    const [row] = (await db.execute(drizzleSql`
      SELECT locked_at, locked_by, locked_until FROM pages WHERE id = ${s.pageId}
    `)) as unknown as Array<{
      locked_at: Date | null;
      locked_by: string | null;
      locked_until: Date | null;
    }>;
    expect(row?.locked_at).toBeNull();
    expect(row?.locked_by).toBeNull();
    expect(row?.locked_until).toBeNull();

    const audits = (await db.execute(drizzleSql`
      SELECT action, metadata
        FROM audit_log
       WHERE workspace_id = ${s.workspaceId}
       ORDER BY created_at DESC
    `)) as unknown as Array<{ action: string; metadata: { pageId?: string } }>;
    expect(audits[0]?.action).toBe('page.auto_unlocked');
    expect(audits[0]?.metadata.pageId).toBe(s.pageId);
  });

  it('leaves indefinite locks (locked_until IS NULL) untouched', async () => {
    const s = await seedLockedPage({
      lockedAtOffsetMs: -60 * 60 * 1000,
      lockedUntilOffsetMs: null,
    });
    const result = await runAutoUnlockSweep(db);
    expect(result.unlockedCount).toBe(0);

    const [row] = (await db.execute(drizzleSql`
      SELECT locked_at FROM pages WHERE id = ${s.pageId}
    `)) as unknown as Array<{ locked_at: Date | null }>;
    expect(row?.locked_at).not.toBeNull();
  });

  it('leaves future locks untouched', async () => {
    const s = await seedLockedPage({
      lockedAtOffsetMs: -60 * 1000,
      lockedUntilOffsetMs: 60 * 60 * 1000,
    });
    const result = await runAutoUnlockSweep(db);
    expect(result.unlockedCount).toBe(0);

    const [row] = (await db.execute(drizzleSql`
      SELECT locked_at FROM pages WHERE id = ${s.pageId}
    `)) as unknown as Array<{ locked_at: Date | null }>;
    expect(row?.locked_at).not.toBeNull();
  });

  it('is a clean no-op when nothing has expired', async () => {
    const result = await runAutoUnlockSweep(db);
    expect(result.unlockedCount).toBe(0);
  });

  it('clears multiple expired rows in a single sweep and emits one audit row per page', async () => {
    const a = await seedLockedPage({
      lockedAtOffsetMs: -60 * 60 * 1000,
      lockedUntilOffsetMs: -10 * 60 * 1000,
    });
    const b = await seedLockedPage({
      lockedAtOffsetMs: -45 * 60 * 1000,
      lockedUntilOffsetMs: -1 * 60 * 1000,
    });
    const result = await runAutoUnlockSweep(db);
    expect(result.unlockedCount).toBe(2);

    const audits = (await db.execute(drizzleSql`
      SELECT workspace_id, action FROM audit_log
    `)) as unknown as Array<{ workspace_id: string; action: string }>;
    const autoUnlocked = audits.filter((r) => r.action === 'page.auto_unlocked');
    expect(autoUnlocked).toHaveLength(2);
    expect(autoUnlocked.map((r) => r.workspace_id).sort()).toEqual(
      [a.workspaceId, b.workspaceId].sort(),
    );
  });
});
