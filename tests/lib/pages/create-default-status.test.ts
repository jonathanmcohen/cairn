import { eq } from 'drizzle-orm';
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

describe('createPage default status (#216 K2)', () => {
  it('defaults a new page to Draft for a fresh workspace', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    expect(page.status).toBe('draft');
  });

  it('still honors an admin override of the workspace default', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db
      .update(schema.workspaces)
      .set({ defaultPageStatus: 'published' })
      .where(eq(schema.workspaces.id, u.workspaceId));
    const p2 = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    expect(p2.status).toBe('published');
  });
});
