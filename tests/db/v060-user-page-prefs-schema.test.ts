import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
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
  await sql`TRUNCATE user_page_prefs, comments, files, db_cells, db_rows, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('v0.6.0 user_page_prefs schema (migration 0020)', () => {
  it('creates user_page_prefs with FKs cascading on user/workspace/page delete', async () => {
    const rows = await sql<{ constraint_name: string; delete_rule: string }[]>`
      SELECT rc.constraint_name, rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = rc.constraint_name
       AND tc.constraint_schema = rc.constraint_schema
      WHERE tc.table_name = 'user_page_prefs'
    `;
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.delete_rule).toBe('CASCADE');
    }
  });

  it('enforces unique (user_id, page_id)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await db.insert(schema.userPagePrefs).values({
      userId: u.userId,
      workspaceId: u.workspaceId,
      pageId: page.id,
      favorite: true,
    });
    await expect(
      db.insert(schema.userPagePrefs).values({
        userId: u.userId,
        workspaceId: u.workspaceId,
        pageId: page.id,
        favorite: true,
      }),
    ).rejects.toThrow();
  });

  it('defaults favorite to false, id via gen_random_uuid()', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const [row] = await db
      .insert(schema.userPagePrefs)
      .values({
        userId: u.userId,
        workspaceId: u.workspaceId,
        pageId: page.id,
      })
      .returning();
    expect(row).toBeDefined();
    expect(row?.favorite).toBe(false);
    expect(row?.id).toMatch(UUID_RE);
  });

  it('creates the favorites + recents read indexes', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'user_page_prefs'
    `;
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('user_page_prefs_favorites_idx');
    expect(names).toContain('user_page_prefs_recents_idx');
    expect(names).toContain('user_page_prefs_user_page_unique');
  });
});
