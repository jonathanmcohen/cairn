import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { lockPage, PageLockedError } from '@/lib/pages/lock';
import { movePage } from '@/lib/pages/move';
import { updatePage } from '@/lib/pages/update';
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

describe('updatePage write gate under lock', () => {
  it('refuses title update from non-locker', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'old',
    });
    const otherId = await seedExtraUser(`other-${Date.now()}@example.com`);
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    await expect(
      updatePage(db, {
        pageId: page.id,
        workspaceId: u.workspaceId,
        byUserId: otherId,
        adminOverride: false,
        patch: { title: 'new' },
      }),
    ).rejects.toBeInstanceOf(PageLockedError);
  });

  it('allows title update from the locker', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'old',
    });
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    await updatePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      byUserId: u.userId,
      adminOverride: false,
      patch: { title: 'new' },
    });
    const [row] = await db
      .select({ title: schema.pages.title })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.title).toBe('new');
  });

  it('allows title update under admin override', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'old',
    });
    const otherId = await seedExtraUser(`other-${Date.now()}@example.com`);
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    await updatePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      byUserId: otherId,
      adminOverride: true,
      patch: { title: 'admin-override' },
    });
    const [row] = await db
      .select({ title: schema.pages.title })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.title).toBe('admin-override');
  });

  it('allows updates when the page is not locked at all', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'old',
    });
    const otherId = await seedExtraUser(`other-${Date.now()}@example.com`);
    await updatePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      byUserId: otherId,
      adminOverride: false,
      patch: { title: 'unlocked-update' },
    });
    const [row] = await db
      .select({ title: schema.pages.title })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.title).toBe('unlocked-update');
  });
});

describe('softDeletePage write gate under lock', () => {
  it('refuses soft-delete from non-locker', async () => {
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
      softDeletePage(db, {
        pageId: page.id,
        workspaceId: u.workspaceId,
        actorUserId: otherId,
        adminOverride: false,
      }),
    ).rejects.toBeInstanceOf(PageLockedError);
  });

  it('allows soft-delete from the locker', async () => {
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
    await softDeletePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      adminOverride: false,
    });
    const [row] = await db
      .select({ deletedAt: schema.pages.deletedAt })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe('expired-lock gate behavior', () => {
  it('allows write from a non-locker non-admin when locked_until has passed', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'old',
    });
    const otherId = await seedExtraUser(`other-${Date.now()}@example.com`);
    // v0.9.0 G2 P14 review — write directly so we control both columns: an
    // expired lock (locked_at = now() - 1h, locked_until = now() - 30min)
    // must NOT block writes; the auto-unlock cron is responsible for clearing
    // the row, but the gate must respect the cutoff.
    const lockedAt = new Date(Date.now() - 60 * 60 * 1000);
    const lockedUntil = new Date(Date.now() - 30 * 60 * 1000);
    await db
      .update(schema.pages)
      .set({ lockedAt, lockedBy: u.userId, lockedUntil })
      .where(eq(schema.pages.id, page.id));

    await updatePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      byUserId: otherId,
      adminOverride: false,
      patch: { title: 'after-expiry' },
    });
    const [row] = await db
      .select({ title: schema.pages.title })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.title).toBe('after-expiry');
  });

  it('still blocks a non-locker non-admin when locked_until is in the future', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'old',
    });
    const otherId = await seedExtraUser(`other-${Date.now()}@example.com`);
    const lockedAt = new Date(Date.now() - 60 * 60 * 1000);
    const lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    await db
      .update(schema.pages)
      .set({ lockedAt, lockedBy: u.userId, lockedUntil })
      .where(eq(schema.pages.id, page.id));

    await expect(
      updatePage(db, {
        pageId: page.id,
        workspaceId: u.workspaceId,
        byUserId: otherId,
        adminOverride: false,
        patch: { title: 'should-fail' },
      }),
    ).rejects.toBeInstanceOf(PageLockedError);
  });

  it('still blocks indefinite (locked_until IS NULL) locks for non-locker non-admin', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'old',
    });
    const otherId = await seedExtraUser(`other-${Date.now()}@example.com`);
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
      lockedUntil: null,
    });
    await expect(
      updatePage(db, {
        pageId: page.id,
        workspaceId: u.workspaceId,
        byUserId: otherId,
        adminOverride: false,
        patch: { title: 'should-fail' },
      }),
    ).rejects.toBeInstanceOf(PageLockedError);
  });
});

describe('movePage write gate under lock', () => {
  it('refuses move from non-locker', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 't',
    });
    const target = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'parent',
    });
    const otherId = await seedExtraUser(`other-${Date.now()}@example.com`);
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    await expect(
      movePage(db, {
        pageId: page.id,
        workspaceId: u.workspaceId,
        newParentId: target.id,
        byUserId: otherId,
        adminOverride: false,
      }),
    ).rejects.toBeInstanceOf(PageLockedError);
  });

  it('allows move from the locker', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 't',
    });
    const target = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'parent',
    });
    await lockPage(db, {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    await movePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      newParentId: target.id,
      byUserId: u.userId,
      adminOverride: false,
    });
    const [row] = await db
      .select({ parentId: schema.pages.parentId })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.parentId).toBe(target.id);
  });
});
