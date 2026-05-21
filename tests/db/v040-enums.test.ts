import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, databases, db_properties, db_views RESTART IDENTITY CASCADE`;
});

async function seedDatabase() {
  const u = await createTestWorkspaceWithUser(db);
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
    .returning();
  if (!page) throw new Error('page insert failed');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId: u.workspaceId, pageId: page.id, createdBy: u.userId })
    .returning();
  if (!database) throw new Error('database insert failed');
  return { ...u, databaseId: database.id };
}

describe('v0.4.0 enum extensions (0011)', () => {
  it('property_type accepts formula/relation/rollup', async () => {
    const { databaseId } = await seedDatabase();
    for (const type of ['formula', 'relation', 'rollup'] as const) {
      const [p] = await db
        .insert(schema.dbProperties)
        .values({ databaseId, name: type, type })
        .returning();
      expect(p?.type).toBe(type);
    }
  });

  it('view_type accepts calendar/timeline', async () => {
    const { databaseId } = await seedDatabase();
    for (const type of ['calendar', 'timeline'] as const) {
      const [v] = await db
        .insert(schema.dbViews)
        .values({ databaseId, name: type, type })
        .returning();
      expect(v?.type).toBe(type);
    }
  });
});
