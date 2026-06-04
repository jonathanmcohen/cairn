import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { federatedSearch } from '@/lib/search/federated';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log, peer_instances RESTART IDENTITY CASCADE`;
});

describe('federatedSearch — membership scope', () => {
  it('returns hits across every workspace the user is a member of', async () => {
    const a = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const b = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    // Add user-a as editor on workspace-b.
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: b.workspaceId, userId: a.userId, role: 'editor' });
    await createPage(db, {
      workspaceId: a.workspaceId,
      createdBy: a.userId,
      title: 'alpha page',
    });
    await createPage(db, {
      workspaceId: b.workspaceId,
      createdBy: b.userId,
      title: 'alpha sibling',
    });

    const result = await federatedSearch(db, {
      userId: a.userId,
      workspaceId: a.workspaceId,
      role: 'editor',
      query: 'alpha',
      filters: {},
      includeAllWorkspaces: false,
    });
    const titles = result.local.map((r) => r.title).sort();
    expect(titles).toEqual(['alpha page', 'alpha sibling']);
  });

  it('does NOT return hits from a workspace the user is not a member of', async () => {
    const a = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const b = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await createPage(db, {
      workspaceId: b.workspaceId,
      createdBy: b.userId,
      title: 'secret thing',
    });

    const result = await federatedSearch(db, {
      userId: a.userId,
      workspaceId: a.workspaceId,
      role: 'editor',
      query: 'secret',
      filters: {},
      includeAllWorkspaces: false,
    });
    expect(result.local).toEqual([]);
  });

  it('skips encrypted pages even when the user is a member', async () => {
    const a = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const enc = await createPage(db, {
      workspaceId: a.workspaceId,
      createdBy: a.userId,
      title: 'secret doc',
    });
    await db.update(schema.pages).set({ encrypted: true }).where(eq(schema.pages.id, enc.id));
    await createPage(db, {
      workspaceId: a.workspaceId,
      createdBy: a.userId,
      title: 'plain doc',
    });

    const result = await federatedSearch(db, {
      userId: a.userId,
      workspaceId: a.workspaceId,
      role: 'editor',
      query: 'doc',
      filters: {},
      includeAllWorkspaces: false,
    });
    expect(result.local.map((r) => r.title)).toEqual(['plain doc']);
  });
});
