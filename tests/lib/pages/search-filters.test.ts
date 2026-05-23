import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { compileSearchFilters, searchPages } from '@/lib/pages/search';
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

describe('compileSearchFilters', () => {
  it('returns no extra clauses for an empty filter set', () => {
    expect(compileSearchFilters({}).length).toBe(0);
  });

  it('emits one fragment per active author/date filter', () => {
    const frags = compileSearchFilters({
      author: '00000000-0000-0000-0000-000000000001',
      dateRange: { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' },
    });
    expect(frags.length).toBe(3);
  });

  it('rejects a non-UUID author to defend the raw-SQL boundary', () => {
    expect(() => compileSearchFilters({ author: "x'; drop table pages;--" })).toThrow();
  });

  it('accepts but ignores types and scopeDatabaseId (no fragments emitted)', () => {
    // The pages table has no database_id column; these filters are reserved
    // for a future pages+db_rows union search, but the filter shape is part
    // of the saved_searches vocabulary so we accept them without emitting SQL.
    expect(
      compileSearchFilters({
        types: ['page'],
        scopeDatabaseId: '00000000-0000-0000-0000-000000000001',
      }).length,
    ).toBe(0);
  });
});

describe('searchPages with filters', () => {
  it('filters by author', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [other] = await db
      .insert(schema.users)
      .values({ email: 'b@x.test', name: 'B', passwordHash: 'h' })
      .returning();
    if (!other) throw new Error('user insert failed');
    await db.insert(schema.workspaceMembers).values({
      workspaceId: a.workspaceId,
      userId: other.id,
      role: 'editor',
    });
    await db
      .insert(schema.pages)
      .values({ workspaceId: a.workspaceId, title: 'alpha notes', createdBy: a.userId });
    await db
      .insert(schema.pages)
      .values({ workspaceId: a.workspaceId, title: 'alpha plans', createdBy: other.id });

    const mine = await searchPages(db, {
      workspaceId: a.workspaceId,
      query: 'alpha',
      filters: { author: a.userId },
    });
    expect(mine.length).toBe(1);
    expect(mine[0]?.title).toBe('alpha notes');

    const all = await searchPages(db, { workspaceId: a.workspaceId, query: 'alpha' });
    expect(all.length).toBe(2);
  });

  it('filters by created_at date range', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await db.insert(schema.pages).values({
      workspaceId: a.workspaceId,
      title: 'old beta',
      createdBy: a.userId,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    await db.insert(schema.pages).values({
      workspaceId: a.workspaceId,
      title: 'new beta',
      createdBy: a.userId,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    const recent = await searchPages(db, {
      workspaceId: a.workspaceId,
      query: 'beta',
      filters: { dateRange: { from: '2026-01-01T00:00:00.000Z' } },
    });
    expect(recent.length).toBe(1);
    expect(recent[0]?.title).toBe('new beta');
  });
});
