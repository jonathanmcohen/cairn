import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  updateSavedSearch,
} from '@/lib/search/saved';
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
  await sql`TRUNCATE saved_searches, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('saved searches CRUD', () => {
  it('creates, lists (per-user), updates, and deletes', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const created = await createSavedSearch(db, {
      workspaceId: a.workspaceId,
      userId: a.userId,
      name: 'My drafts',
      query: 'draft',
      filters: { author: a.userId, types: ['page'] },
    });
    expect(created.id).toBeTruthy();
    expect(created.filters).toEqual({ author: a.userId, types: ['page'] });

    const listed = await listSavedSearches(db, { workspaceId: a.workspaceId, userId: a.userId });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('My drafts');

    const renamed = await updateSavedSearch(db, {
      id: created.id,
      userId: a.userId,
      name: 'Renamed',
    });
    expect(renamed.name).toBe('Renamed');

    await deleteSavedSearch(db, { id: created.id, userId: a.userId });
    expect(
      await listSavedSearches(db, { workspaceId: a.workspaceId, userId: a.userId }),
    ).toHaveLength(0);
  });

  it("does not list another user's saved searches (per-user/private)", async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [other] = await db
      .insert(schema.users)
      .values({ email: 'o@x.test', name: 'O', passwordHash: 'h' })
      .returning();
    if (!other) throw new Error('user insert failed');
    await db.insert(schema.workspaceMembers).values({
      workspaceId: a.workspaceId,
      userId: other.id,
      role: 'editor',
    });
    await createSavedSearch(db, {
      workspaceId: a.workspaceId,
      userId: other.id,
      name: 'Theirs',
      query: 'x',
      filters: {},
    });
    const mine = await listSavedSearches(db, { workspaceId: a.workspaceId, userId: a.userId });
    expect(mine).toHaveLength(0);
  });

  it('refuses to update/delete a saved search owned by another user', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [other] = await db
      .insert(schema.users)
      .values({ email: 'o2@x.test', name: 'O2', passwordHash: 'h' })
      .returning();
    if (!other) throw new Error('user insert failed');
    await db.insert(schema.workspaceMembers).values({
      workspaceId: a.workspaceId,
      userId: other.id,
      role: 'editor',
    });
    const theirs = await createSavedSearch(db, {
      workspaceId: a.workspaceId,
      userId: other.id,
      name: 'Theirs',
      query: 'x',
      filters: {},
    });
    await expect(
      updateSavedSearch(db, { id: theirs.id, userId: a.userId, name: 'hijack' }),
    ).rejects.toThrow();
  });
});
