import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { isLocked, lockPage, PageLockedError, unlockPage } from '@/lib/pages/lock';
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

async function seedExtraUser(email: string): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: 'other' })
    .returning();
  if (!u) throw new Error('failed to create user');
  return u.id;
}

describe('lockPage / unlockPage / isLocked', () => {
  it('roundtrip — lock then unlock by the locker', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 't',
    });

    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    const locked = await isLocked(db, page.id);
    expect(locked.locked).toBe(true);
    expect(locked.lockedBy).toBe(u.userId);
    expect(locked.lockedUntil).toBeNull();

    await unlockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
      adminOverride: false,
    });
    const after = await isLocked(db, page.id);
    expect(after.locked).toBe(false);
    expect(after.lockedBy).toBeNull();
  });

  it('lockPage writes a page.locked audit row', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 't',
    });
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId));
    expect(audits.map((a) => a.action)).toContain('page.locked');
    const lockRow = audits.find((a) => a.action === 'page.locked');
    expect(lockRow?.targetType).toBe('page');
    expect(lockRow?.targetId).toBe(page.id);
    expect(lockRow?.actorUserId).toBe(u.userId);
  });

  it('unlockPage by locker writes page.unlocked', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 't',
    });
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    await unlockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
      adminOverride: false,
    });
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId));
    expect(audits.map((a) => a.action).sort()).toEqual(['page.locked', 'page.unlocked']);
  });

  it('admin override emits page.unlock_overridden_by_admin', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 't',
    });
    const adminId = await seedExtraUser(`admin-${Date.now()}@example.com`);
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    await unlockPage(db, {
      pageId: page.id,
      byUserId: adminId,
      workspaceId: u.workspaceId,
      adminOverride: true,
    });
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId));
    expect(audits.map((a) => a.action)).toContain('page.unlock_overridden_by_admin');
    expect(audits.map((a) => a.action)).not.toContain('page.unlocked');
  });

  it('lockPage accepts optional lockedUntil', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 't',
    });
    const until = new Date(Date.now() + 60_000);
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
      lockedUntil: until,
    });
    const state = await isLocked(db, page.id);
    expect(state.locked).toBe(true);
    expect(state.lockedUntil?.getTime()).toBeCloseTo(until.getTime(), -3);
  });

  it('unlockPage from non-locker without adminOverride throws PageLockedError', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 't',
    });
    const otherId = await seedExtraUser(`other-${Date.now()}@example.com`);
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    await expect(
      unlockPage(db, {
        pageId: page.id,
        byUserId: otherId,
        workspaceId: u.workspaceId,
        adminOverride: false,
      }),
    ).rejects.toBeInstanceOf(PageLockedError);
  });

  it('unlockPage on an already-unlocked page is a no-op', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 't',
    });
    await unlockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
      adminOverride: false,
    });
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId));
    // no audit rows for a no-op unlock
    expect(audits).toEqual([]);
  });
});
