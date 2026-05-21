import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { PageConflictError, updatePage } from '@/lib/pages/update';
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

describe('updatePage', () => {
  it('updates title and returns updated row', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Old',
    });
    const updated = await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: { title: 'New' },
    });
    expect(updated.title).toBe('New');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(p.updatedAt.getTime());
  });

  it('updates content and rebuilds content_text via trigger', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const updated = await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
        },
      },
    });
    expect(updated.contentText).toContain('Hello world');
  });

  it('updates icon to a new emoji', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const updated = await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: { icon: '🐉' },
    });
    expect(updated.icon).toBe('🐉');
  });

  it('rejects writes with stale expectedUpdatedAt', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: { title: 'First' },
    });
    await expect(
      updatePage(db, {
        pageId: p.id,
        workspaceId: u.workspaceId,
        patch: { title: 'Second' },
        expectedUpdatedAt: p.updatedAt, // stale
      }),
    ).rejects.toBeInstanceOf(PageConflictError);
  });

  it('fails to update a page in another workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await expect(
      updatePage(db, {
        pageId: p.id,
        workspaceId: a.workspaceId,
        patch: { title: 'X' },
      }),
    ).rejects.toThrow(/not found/i);
  });
});
