// v0.10.0 D5 — listArchivedPages: the /archived browse view's query.
// Archived is a lifecycle status (NOT trash): rows keep deleted_at NULL but
// are hidden from the sidebar tree + search, so this lister is the only
// workspace-scoped way to find them again.
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listArchivedPages } from '@/lib/pages/archived';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

type SeedPageOpts = {
  workspaceId: string;
  userId: string;
  title: string;
  status?: schema.PageStatus;
  parentId?: string | null;
  deleted?: boolean;
  updatedDaysAgo?: number;
};

async function seedPage(opts: SeedPageOpts): Promise<string> {
  const rows = (await db.execute(drizzleSql`
    INSERT INTO pages (workspace_id, created_by, title, content, status, parent_id,
                       deleted_at, deleted_root)
    VALUES (
      ${opts.workspaceId},
      ${opts.userId},
      ${opts.title},
      '{}'::jsonb,
      ${opts.status ?? 'published'},
      ${opts.parentId ?? null},
      ${opts.deleted ? drizzleSql`now()` : null},
      ${opts.deleted ?? false}
    )
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  const id = rows[0]?.id;
  if (!id) throw new Error('failed to seed page');
  // Backdate updated_at in a second statement: the pages_search_sync_trigger
  // (BEFORE INSERT OR UPDATE OF title, content) stamps NEW.updated_at = now()
  // on insert, so an inline value would be silently overwritten. A bare
  // updated_at UPDATE doesn't fire that trigger.
  if (opts.updatedDaysAgo) {
    await db.execute(drizzleSql`
      UPDATE pages
      SET updated_at = now() - (${String(opts.updatedDaysAgo)} || ' days')::interval
      WHERE id = ${id}
    `);
  }
  return id;
}

async function seedArchiveAudit(args: {
  workspaceId: string;
  pageId: string;
  daysAgo: number;
  to?: string;
}): Promise<void> {
  await db.execute(drizzleSql`
    INSERT INTO audit_log (workspace_id, action, target_type, target_id, metadata, created_at)
    VALUES (
      ${args.workspaceId},
      'page.status_changed',
      'page',
      ${args.pageId},
      ${JSON.stringify({ from: 'published', to: args.to ?? 'archived' })}::jsonb,
      now() - (${String(args.daysAgo)} || ' days')::interval
    )
  `);
}

describe('listArchivedPages', () => {
  it('lists only archived, non-deleted pages of the given workspace', async () => {
    const own = await createTestWorkspaceWithUser(db, {});
    const other = await createTestWorkspaceWithUser(db, {});

    const archived = await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'archived page',
      status: 'archived',
    });
    await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'still published',
      status: 'published',
    });
    await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'a draft',
      status: 'draft',
    });
    // Archived AND trashed → belongs to the trash view, not /archived.
    await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'archived but trashed',
      status: 'archived',
      deleted: true,
    });
    // Tenant isolation: a foreign workspace's archived page never leaks.
    await seedPage({
      workspaceId: other.workspaceId,
      userId: other.userId,
      title: 'foreign archived',
      status: 'archived',
    });

    const entries = await listArchivedPages(db, own.workspaceId);
    expect(entries.map((e) => e.id)).toEqual([archived]);
    expect(entries[0]?.title).toBe('archived page');
  });

  it('derives archivedAt from the page.status_changed audit row, newest-first ordering', async () => {
    const own = await createTestWorkspaceWithUser(db, {});
    const older = await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'older',
      status: 'archived',
      updatedDaysAgo: 30,
    });
    const newer = await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'newer',
      status: 'archived',
      updatedDaysAgo: 30,
    });
    await seedArchiveAudit({ workspaceId: own.workspaceId, pageId: older, daysAgo: 10 });
    await seedArchiveAudit({ workspaceId: own.workspaceId, pageId: newer, daysAgo: 2 });
    // A non-archive transition row must NOT win over the archive row.
    await seedArchiveAudit({
      workspaceId: own.workspaceId,
      pageId: older,
      daysAgo: 1,
      to: 'draft',
    });

    const entries = await listArchivedPages(db, own.workspaceId);
    expect(entries.map((e) => e.id)).toEqual([newer, older]);

    const day = 24 * 60 * 60 * 1000;
    const newerEntry = entries.find((e) => e.id === newer);
    const olderEntry = entries.find((e) => e.id === older);
    expect(Math.abs((Date.now() - (newerEntry?.archivedAt.getTime() ?? 0)) / day - 2)).toBeLessThan(
      0.1,
    );
    expect(
      Math.abs((Date.now() - (olderEntry?.archivedAt.getTime() ?? 0)) / day - 10),
    ).toBeLessThan(0.1);
  });

  it('falls back to updated_at when no audit row exists', async () => {
    const own = await createTestWorkspaceWithUser(db, {});
    const id = await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'no audit',
      status: 'archived',
      updatedDaysAgo: 7,
    });
    const entries = await listArchivedPages(db, own.workspaceId);
    const day = 24 * 60 * 60 * 1000;
    expect(entries[0]?.id).toBe(id);
    expect(Math.abs((Date.now() - (entries[0]?.archivedAt.getTime() ?? 0)) / day - 7)).toBeLessThan(
      0.1,
    );
  });

  it('returns the ancestor chain as parent context, excluding the page itself', async () => {
    const own = await createTestWorkspaceWithUser(db, {});
    const root = await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'Root',
      status: 'published',
    });
    const mid = await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'Mid',
      status: 'published',
      parentId: root,
    });
    const leaf = await seedPage({
      workspaceId: own.workspaceId,
      userId: own.userId,
      title: 'Leaf',
      status: 'archived',
      parentId: mid,
    });

    const entries = await listArchivedPages(db, own.workspaceId);
    expect(entries.map((e) => e.id)).toEqual([leaf]);
    expect(entries[0]?.parents.map((p) => p.title)).toEqual(['Root', 'Mid']);
  });
});
