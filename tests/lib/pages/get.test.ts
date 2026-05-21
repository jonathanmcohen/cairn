import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { getPage } from '@/lib/pages/get';
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

describe('getPage', () => {
  it('returns the page when it belongs to the workspace and is not deleted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'X' });
    const found = await getPage(db, { pageId: p.id, workspaceId: u.workspaceId });
    expect(found?.id).toBe(p.id);
  });

  it('returns null when the page is in a different workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    const found = await getPage(db, { pageId: p.id, workspaceId: a.workspaceId });
    expect(found).toBeNull();
  });

  it('returns null for soft-deleted pages by default', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await sql`UPDATE pages SET deleted_at = now() WHERE id = ${p.id}`;
    const found = await getPage(db, { pageId: p.id, workspaceId: u.workspaceId });
    expect(found).toBeNull();
  });
});
