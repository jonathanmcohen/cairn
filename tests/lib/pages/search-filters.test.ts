import { sql as rawSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { compileSearchFilters, searchPages } from '@/lib/pages/search';
import { __resetEmbeddingProviderForTests } from '@/lib/search/embed';
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
  await sql`TRUNCATE page_embeddings, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
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

// ── P13: semantic + hybrid modes ──────────────────────────────────────────

const EMBED_DIM = 384;

/** Build a 384-dim unit vector that's mostly the j-th basis vector. The first
 * slot makes the cosine distance ordering deterministic across runs without
 * forcing perfectly-aligned vectors (avoids ties that hide ranking bugs).
 *
 * For j=0..N-1, this produces vectors with cosine distance 0 against
 * themselves and ≈ 1 against any other basis index → kNN order matches
 * the j index when the query is the j=k basis vector.
 */
function basisVec(j: number): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  v[j % EMBED_DIM] = 1;
  return v;
}

function vecLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

/** Stub the embedding provider with a fetch mock that always returns the
 * given vector — set up via the remote-provider path (env var) so we never
 * load Xenova/ORT in this test. */
function stubEmbedQueryVec(vec: number[]): void {
  process.env.CAIRN_EMBEDDING_URL = 'http://stub.local/v1/embeddings';
  __resetEmbeddingProviderForTests();
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [{ embedding: vec }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

async function seedPageWithEmbedding(
  workspaceId: string,
  createdBy: string,
  title: string,
  contentText: string,
  vec: number[],
): Promise<string> {
  const [row] = await db
    .insert(schema.pages)
    .values({ workspaceId, title, contentText, createdBy })
    .returning({ id: schema.pages.id });
  if (!row) throw new Error('page insert failed');
  await db.execute(rawSql`
    INSERT INTO page_embeddings (page_id, workspace_id, embedding, content_hash)
    VALUES (${row.id}::uuid, ${workspaceId}::uuid, ${vecLiteral(vec)}::vector, 'stub-hash-' || ${row.id})
  `);
  return row.id;
}

describe('searchPages mode=semantic (P13)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CAIRN_EMBEDDING_URL;
    __resetEmbeddingProviderForTests();
  });

  it('returns nearest neighbors ordered by cosine distance to the query embedding', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    // Three pages with distinct unit vectors. Query vec equals page A's vec
    // → A should come first; B (basis idx 1) closer than C (basis idx 2)
    // is irrelevant since they're orthogonal — both at cosine distance 1.
    const idA = await seedPageWithEmbedding(u.workspaceId, u.userId, 'A', 'A body', basisVec(0));
    await seedPageWithEmbedding(u.workspaceId, u.userId, 'B', 'B body', basisVec(1));
    await seedPageWithEmbedding(u.workspaceId, u.userId, 'C', 'C body', basisVec(2));

    stubEmbedQueryVec(basisVec(0));

    const results = await searchPages(db, {
      workspaceId: u.workspaceId,
      query: 'anything (mocked)',
      mode: 'semantic',
      limit: 3,
    });
    expect(results.length).toBe(3);
    expect(results[0]?.id).toBe(idA);
    expect(results[0]?.rank).toBeGreaterThan(results[1]?.rank ?? Number.POSITIVE_INFINITY);
  });

  it('returns empty for an empty query', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await seedPageWithEmbedding(u.workspaceId, u.userId, 'A', 'A body', basisVec(0));
    const results = await searchPages(db, {
      workspaceId: u.workspaceId,
      query: '',
      mode: 'semantic',
    });
    expect(results).toEqual([]);
  });

  it('excludes pages from other workspaces in semantic mode', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const b = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await seedPageWithEmbedding(b.workspaceId, b.userId, 'foreign', 'body', basisVec(0));
    stubEmbedQueryVec(basisVec(0));
    const results = await searchPages(db, {
      workspaceId: a.workspaceId,
      query: 'q',
      mode: 'semantic',
    });
    expect(results).toEqual([]);
  });

  it('mode=fts preserves legacy behavior (FTS+trigram path unchanged)', async () => {
    // Regression guard: unset and explicit 'fts' return the same shape and
    // ids as the v0.6.0 path. The title FTS+trigram is enough for parity.
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [row] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'quokka encyclopedia', createdBy: u.userId })
      .returning({ id: schema.pages.id });
    if (!row) throw new Error('page insert failed');
    const explicit = await searchPages(db, {
      workspaceId: u.workspaceId,
      query: 'quokka',
      mode: 'fts',
    });
    expect(explicit.some((r) => r.id === row.id)).toBe(true);
    const implicit = await searchPages(db, { workspaceId: u.workspaceId, query: 'quokka' });
    expect(implicit.length).toBe(explicit.length);
    expect(implicit.map((r) => r.id)).toEqual(explicit.map((r) => r.id));
  });
});

describe('searchPages mode=hybrid (P13)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CAIRN_EMBEDDING_URL;
    __resetEmbeddingProviderForTests();
  });

  it('RRF-merges FTS and semantic — page present in both ranks above either single-source page', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    // p1: literal "postgres" match in title/content AND nearest semantic neighbor.
    // p2: no literal match, but nearest semantic neighbor #2.
    // p3: literal "postgres" match in title, but far in semantic space.
    const p1 = await seedPageWithEmbedding(
      u.workspaceId,
      u.userId,
      'postgres tuning',
      'postgres tuning notes',
      basisVec(0),
    );
    const p2 = await seedPageWithEmbedding(
      u.workspaceId,
      u.userId,
      'indexing strategies',
      'database performance ideas',
      basisVec(1),
    );
    const p3 = await seedPageWithEmbedding(
      u.workspaceId,
      u.userId,
      'postgres install',
      'how to install postgres on linux',
      basisVec(7), // far from the query vec
    );

    stubEmbedQueryVec(basisVec(0));

    const results = await searchPages(db, {
      workspaceId: u.workspaceId,
      query: 'postgres tuning',
      mode: 'hybrid',
      limit: 10,
    });
    expect(results.length).toBeGreaterThan(0);
    const positions = new Map(results.map((r, i) => [r.id, i]));
    // p1 is in BOTH the FTS and semantic top results → must outrank p2 and p3.
    expect(positions.get(p1)).toBeLessThan(positions.get(p2) ?? Number.POSITIVE_INFINITY);
    expect(positions.get(p1)).toBeLessThan(positions.get(p3) ?? Number.POSITIVE_INFINITY);
  });

  it('hybrid returns empty for an empty query', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await seedPageWithEmbedding(u.workspaceId, u.userId, 'A', 'A body', basisVec(0));
    const results = await searchPages(db, {
      workspaceId: u.workspaceId,
      query: '',
      mode: 'hybrid',
    });
    expect(results).toEqual([]);
  });
});
