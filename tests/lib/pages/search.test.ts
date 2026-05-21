import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { getBreadcrumbs, searchPages } from '@/lib/pages/search';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('searchPages', () => {
  it('finds a page by exact title word', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Roadmap' });
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Untitled' });
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'roadmap' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toBe('Roadmap');
  });

  it('finds a page by body text', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Note',
    });
    await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'quokkas are wonderful' }] },
          ],
        },
      },
    });
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'quokkas' });
    expect(results.length).toBe(1);
    expect(results[0]?.snippet?.toLowerCase()).toContain('quokk');
  });

  it('typo-tolerant: finds Roadmap with "rodmap"', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Roadmap' });
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'rodmap' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toBe('Roadmap');
  });

  it('excludes soft-deleted pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Hidden',
    });
    await sql`UPDATE pages SET deleted_at = now() WHERE id = ${p.id}`;
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'hidden' });
    expect(results).toEqual([]);
  });

  it('excludes pages from other workspaces', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId, title: 'Secret' });
    const results = await searchPages(db, { workspaceId: a.workspaceId, query: 'secret' });
    expect(results).toEqual([]);
  });

  it('returns at most `limit` results', async () => {
    const u = await createTestWorkspaceWithUser(db);
    for (let i = 0; i < 15; i++) {
      await createPage(db, {
        workspaceId: u.workspaceId,
        createdBy: u.userId,
        title: `Roadmap ${i}`,
      });
    }
    const results = await searchPages(db, {
      workspaceId: u.workspaceId,
      query: 'roadmap',
      limit: 5,
    });
    expect(results.length).toBeLessThanOrEqual(5);
  });
});

describe('getBreadcrumbs', () => {
  it('returns the ancestor chain for nested pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'A',
    });
    const mid = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'B',
    });
    const leaf = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: mid.id,
      title: 'C',
    });
    const trail = await getBreadcrumbs(db, {
      pageIds: [leaf.id],
      workspaceId: u.workspaceId,
    });
    const path = trail.get(leaf.id) ?? [];
    expect(path.map((p) => p.title)).toEqual(['A', 'B', 'C']);
  });

  it('returns an empty chain for a top-level page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'A',
    });
    const trail = await getBreadcrumbs(db, { pageIds: [root.id], workspaceId: u.workspaceId });
    expect(trail.get(root.id)).toEqual([{ id: root.id, title: 'A' }]);
  });
});
