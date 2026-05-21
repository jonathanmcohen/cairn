import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createProperty } from '@/lib/databases/properties';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, databases, db_properties RESTART IDENTITY CASCADE`;
});

async function makeDb(workspaceId: string, userId: string) {
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: userId })
    .returning();
  if (!page) throw new Error('page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, createdBy: userId })
    .returning();
  if (!database) throw new Error('db');
  return database.id;
}

describe('relation property config', () => {
  it('accepts { targetDatabaseId } pointing at a same-workspace db', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const dbA = await makeDb(u.workspaceId, u.userId);
    const dbB = await makeDb(u.workspaceId, u.userId);
    const prop = await createProperty(db, {
      databaseId: dbA,
      workspaceId: u.workspaceId,
      name: 'Linked',
      type: 'relation',
      config: { targetDatabaseId: dbB },
    });
    expect((prop.config as { targetDatabaseId: string }).targetDatabaseId).toBe(dbB);
  });

  it('rejects config missing targetDatabaseId', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const dbA = await makeDb(u.workspaceId, u.userId);
    await expect(
      createProperty(db, {
        databaseId: dbA,
        workspaceId: u.workspaceId,
        name: 'Linked',
        type: 'relation',
        config: {},
      }),
    ).rejects.toThrow();
  });

  it('rejects a target database in another workspace (cross-workspace)', async () => {
    const u1 = await createTestWorkspaceWithUser(db);
    const u2 = await createTestWorkspaceWithUser(db);
    const dbA = await makeDb(u1.workspaceId, u1.userId);
    const foreign = await makeDb(u2.workspaceId, u2.userId);
    await expect(
      createProperty(db, {
        databaseId: dbA,
        workspaceId: u1.workspaceId,
        name: 'Linked',
        type: 'relation',
        config: { targetDatabaseId: foreign },
      }),
    ).rejects.toThrow(/same workspace|not found/i);
  });
});
