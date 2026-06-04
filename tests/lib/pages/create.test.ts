import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('createPage', () => {
  it('creates a top-level page with default title and empty content', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    expect(page.title).toBe('');
    expect(page.parentId).toBeNull();
    expect((page.content as { type: string }).type).toBe('doc');
    expect(page.contentText).toBe('');
  });

  it('stores an empty title when none is provided (no literal Untitled)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    expect(page.title).toBe('');
  });

  it('creates a nested page under a parent', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const parent = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const child = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: parent.id,
      title: 'Child',
    });
    expect(child.parentId).toBe(parent.id);
    expect(child.title).toBe('Child');
  });

  it('rejects a parent in a different workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const foreign = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await expect(
      createPage(db, {
        workspaceId: a.workspaceId,
        createdBy: a.userId,
        parentId: foreign.id,
      }),
    ).rejects.toThrow(/parent.*workspace/i);
  });
});
