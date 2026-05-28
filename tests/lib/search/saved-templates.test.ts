import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createTemplate, deleteTemplate, listTemplates } from '@/lib/search/saved';
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
  await sql`TRUNCATE saved_searches, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

describe('saved templates', () => {
  it('create + list round-trips', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const t = await createTemplate(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      templateName: 'bugs',
      expansion: 'tag:bug type:page status:open',
    });
    expect(t.templateName).toBe('bugs');
    const list = await listTemplates(db, { workspaceId: u.workspaceId, userId: u.userId });
    expect(list).toHaveLength(1);
    expect(list[0]?.expansion).toBe('tag:bug type:page status:open');
  });

  it('rejects duplicate template_name per (workspace,user)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createTemplate(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      templateName: 'bugs',
      expansion: 'tag:bug',
    });
    await expect(
      createTemplate(db, {
        workspaceId: u.workspaceId,
        userId: u.userId,
        templateName: 'bugs',
        expansion: 'tag:other',
      }),
    ).rejects.toThrow();
  });

  it('allows same template_name across different users in same workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    // Add a second user to the same workspace.
    const [u2] = await db
      .insert(schema.users)
      .values({ email: `b-${a.workspaceId}@example.com`, passwordHash: 'h', name: 'B' })
      .returning();
    if (!u2) throw new Error('failed to create user 2');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: a.workspaceId, userId: u2.id, role: 'editor' });

    await createTemplate(db, {
      workspaceId: a.workspaceId,
      userId: a.userId,
      templateName: 'bugs',
      expansion: 'tag:bug',
    });
    await expect(
      createTemplate(db, {
        workspaceId: a.workspaceId,
        userId: u2.id,
        templateName: 'bugs',
        expansion: 'tag:other',
      }),
    ).resolves.toBeTruthy();
  });

  it('delete removes the row', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const t = await createTemplate(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      templateName: 'bugs',
      expansion: 'tag:bug',
    });
    await deleteTemplate(db, { id: t.id, userId: u.userId });
    expect(await listTemplates(db, { workspaceId: u.workspaceId, userId: u.userId })).toHaveLength(
      0,
    );
  });

  it('listTemplates does NOT include rows with template_name NULL', async () => {
    const u = await createTestWorkspaceWithUser(db);
    // Insert one plain saved-search row (template_name null) directly.
    await db.insert(schema.savedSearches).values({
      workspaceId: u.workspaceId,
      userId: u.userId,
      name: 'plain',
      query: '',
      filters: {},
    });
    await createTemplate(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      templateName: 'bugs',
      expansion: 'tag:bug',
    });
    const list = await listTemplates(db, { workspaceId: u.workspaceId, userId: u.userId });
    expect(list).toHaveLength(1);
    expect(list[0]?.templateName).toBe('bugs');
  });
});
