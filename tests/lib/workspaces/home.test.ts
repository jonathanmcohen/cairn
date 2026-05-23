import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { resolveLandingPage } from '@/lib/workspaces/home';
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

describe('resolveLandingPage', () => {
  it('returns home_page_id when set and live', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [home] = await db
      .insert(schema.pages)
      .values({ workspaceId: a.workspaceId, title: 'Home', createdBy: a.userId })
      .returning();
    if (!home) throw new Error('page insert failed');
    await db
      .update(schema.workspaces)
      .set({ homePageId: home.id })
      .where(eq(schema.workspaces.id, a.workspaceId));

    const landing = await resolveLandingPage(db, { workspaceId: a.workspaceId, userId: a.userId });
    expect(landing).toBe(home.id);
  });

  it('falls back to the first page when home_page_id is null', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [first] = await db
      .insert(schema.pages)
      .values({ workspaceId: a.workspaceId, title: 'First', createdBy: a.userId })
      .returning();
    if (!first) throw new Error('page insert failed');
    const landing = await resolveLandingPage(db, { workspaceId: a.workspaceId, userId: a.userId });
    expect(landing).toBe(first.id);
  });

  it('ignores a home_page_id pointing at a trashed page', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [gone] = await db
      .insert(schema.pages)
      .values({
        workspaceId: a.workspaceId,
        title: 'Gone',
        createdBy: a.userId,
        deletedAt: new Date(),
      })
      .returning();
    const [live] = await db
      .insert(schema.pages)
      .values({ workspaceId: a.workspaceId, title: 'Live', createdBy: a.userId })
      .returning();
    if (!gone || !live) throw new Error('page insert failed');
    await db
      .update(schema.workspaces)
      .set({ homePageId: gone.id })
      .where(eq(schema.workspaces.id, a.workspaceId));
    const landing = await resolveLandingPage(db, { workspaceId: a.workspaceId, userId: a.userId });
    expect(landing).toBe(live.id);
  });

  it('returns null for an empty workspace', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    expect(
      await resolveLandingPage(db, { workspaceId: a.workspaceId, userId: a.userId }),
    ).toBeNull();
  });
});
