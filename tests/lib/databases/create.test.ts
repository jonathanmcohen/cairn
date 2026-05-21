import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { getDatabaseWithMeta } from '@/lib/databases/get';
import { createPage } from '@/lib/pages/create';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  await sql`TRUNCATE databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('createDatabase + getDatabaseWithMeta', () => {
  it('creates a database under a page, seeded with Name property + Default view', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const d = await createDatabase(db, {
      workspaceId: u.workspaceId,
      pageId: p.id,
      createdBy: u.userId,
      name: 'Tasks',
    });
    expect(d.name).toBe('Tasks');
    const meta = await getDatabaseWithMeta(db, { databaseId: d.id, workspaceId: u.workspaceId });
    expect(meta?.properties).toHaveLength(1);
    expect(meta?.properties[0]?.name).toBe('Name');
    expect(meta?.views).toHaveLength(1);
    expect(meta?.views[0]?.type).toBe('table');
  });

  it('rejects creating a database under a page in a different workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await expect(
      createDatabase(db, { workspaceId: a.workspaceId, pageId: p.id, createdBy: a.userId }),
    ).rejects.toThrow(/page.*workspace/i);
  });

  it('uses default name when none provided', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const d = await createDatabase(db, {
      workspaceId: u.workspaceId,
      pageId: p.id,
      createdBy: u.userId,
    });
    expect(d.name).toBe('Untitled database');
  });

  it('getDatabaseWithMeta returns null for wrong workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    const d = await createDatabase(db, {
      workspaceId: b.workspaceId,
      pageId: p.id,
      createdBy: b.userId,
    });
    const meta = await getDatabaseWithMeta(db, { databaseId: d.id, workspaceId: a.workspaceId });
    expect(meta).toBeNull();
  });
});
