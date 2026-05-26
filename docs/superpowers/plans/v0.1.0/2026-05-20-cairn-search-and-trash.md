# Cairn Search & Trash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the global ⌘K search palette and the soft-delete trash bin. Pages already store `content_tsv` from Plan 2; this plan adds `pg_trgm` for fuzzy title matching, the search API, the search UI, the trash list, restore + hard-delete endpoints, and an opportunistic auto-purge runner.

**Architecture:** Search and trash are independent surfaces but share the `pages` schema from Plan 2. Search ranks by title (A-weight) + body (B-weight) tsvector with a `pg_trgm` similarity fallback on title for typo tolerance. Snippets come from `ts_headline`. Breadcrumbs use a recursive CTE walking `parent_id`. Trash queries `deleted_root = true` rows ordered by `deleted_at desc`; restore uses the `deleted_root` flag to scope the cascade restore correctly. Auto-purge is throttled to once per hour per instance via a Postgres advisory lock + a `system_meta` key, invoked fire-and-forget from request handlers — no separate worker process.

**Tech Stack additions:** `pg_trgm` Postgres extension, `cmdk` (shadcn-compatible command palette primitive), nothing new on the runtime side.

---

## What's in scope for Plan 3

- `pg_trgm` extension enabled; trigram GIN index on `pages.title`
- `system_meta` table for cross-process flags (currently: last purge time)
- `searchPages(workspaceId, query, limit)` helper: FTS + fuzzy title fallback, returns title, snippet (`ts_headline`), breadcrumb path, rank
- `GET /api/search?q=...` route (viewer+)
- Global search palette UI: ⌘K (or Ctrl+K) opens; debounced query; arrow nav; Enter to open
- `listTrash(workspaceId)`, `restorePage(...)`, `hardDeletePage(...)` helpers + tests
- `GET /api/trash`, `POST /api/pages/[pageId]/restore`, `DELETE /api/trash/[pageId]` routes
- Trash bin route `/trash` and a sidebar link
- `autoPurge(retentionDays)` helper using `pg_try_advisory_lock` + a `system_meta` "last_purge_at" row, throttled to ≤ 1/hour
- Fire-and-forget purge invocation from `/api/pages` and `/api/trash/*` API routes (acceptable for v0.1.0; no separate worker)
- ⌘K keyboard shortcut wiring

## What's explicitly NOT in this plan

- File/image uploads + cover images + markdown — Plan 4
- Database (inline DB) blocks — Plan 5
- Release workflow + drag handle polish — Plan 6
- Search result ranking tuning beyond title/body weights (e.g. user-specific boost) — deferred
- Page version history — out of scope per spec
- Real-time search (live results as you type beyond debounce) — debounced fetch is sufficient
- Saved searches, search history — out of scope

---

## File structure produced by this plan

```
cairn/
├── drizzle/
│   └── migrations/
│       ├── 0004_search_and_trash.sql       # NEW
│       └── meta/...                        # journal + snapshot updates
├── src/
│   ├── app/
│   │   ├── (app)/
│   │   │   ├── layout.tsx                  # MODIFIED — mount SearchPalette
│   │   │   └── trash/
│   │   │       └── page.tsx                # NEW — trash list view
│   │   └── api/
│   │       ├── search/route.ts             # NEW — GET q
│   │       ├── trash/
│   │       │   ├── route.ts                # NEW — GET trash list
│   │       │   └── [pageId]/route.ts       # NEW — DELETE hard
│   │       └── pages/[pageId]/restore/route.ts  # NEW — POST restore
│   ├── components/
│   │   ├── search-palette.tsx              # NEW — cmdk-based ⌘K palette
│   │   └── sidebar.tsx                     # MODIFIED — add Trash link
│   ├── db/
│   │   └── schema/
│   │       ├── system-meta.ts              # NEW — key/value table
│   │       └── index.ts                    # MODIFIED — export system-meta
│   └── lib/
│       ├── pages/
│       │   ├── search.ts                   # NEW — searchPages, getBreadcrumbs
│       │   ├── trash.ts                    # NEW — listTrash, restorePage, hardDeletePage
│       │   └── auto-purge.ts               # NEW — autoPurge with advisory lock
│       └── editor/
│           └── (unchanged)
├── tests/
│   ├── lib/
│   │   ├── pages/
│   │   │   ├── search.test.ts              # NEW
│   │   │   ├── trash.test.ts               # NEW
│   │   │   └── auto-purge.test.ts          # NEW
│   └── api/
│       ├── search.test.ts                  # NEW
│       └── trash-routes.test.ts            # NEW
```

---

## Conventions

- Same as Plan 2: pnpm, TDD with full code blocks, frequent conventional-commit commits, no pushes from subagents.
- All shell commands prefixed with `source ~/.zshenv && ` for PATH + Docker env vars.
- Every API route uses `requireRole` (or `requirePageAccess` for page-scoped operations).

---

## Task 1: Migration — pg_trgm extension, trigram index, system_meta table

**Goal:** Enable the `pg_trgm` Postgres extension, add a trigram GIN index on `pages.title` for typo-tolerant title search, and create a `system_meta` key/value table that the auto-purge logic uses to track its last run.

**Files:**
- Create: `src/db/schema/system-meta.ts`
- Modify: `src/db/schema/index.ts`
- Generate + edit: `drizzle/migrations/0004_*.sql`
- Create: `tests/db/system-meta-schema.test.ts`

- [x] **Step 1: Write `src/db/schema/system-meta.ts`**

```ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const systemMeta = pgTable('system_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SystemMeta = typeof systemMeta.$inferSelect;
export type NewSystemMeta = typeof systemMeta.$inferInsert;
```

- [x] **Step 2: Update `src/db/schema/index.ts`**

Add `export * from './system-meta';` after the existing exports.

- [x] **Step 3: Write failing test `tests/db/system-meta-schema.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';

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
  await sql`TRUNCATE system_meta RESTART IDENTITY`;
});

describe('system_meta schema + pg_trgm extension', () => {
  it('can upsert a key/value', async () => {
    await db.insert(schema.systemMeta).values({ key: 'last_purge_at', value: 'never' });
    const [row] = await db.select().from(schema.systemMeta);
    expect(row?.key).toBe('last_purge_at');
    expect(row?.value).toBe('never');
  });

  it('pg_trgm extension is installed', async () => {
    const rows = await sql<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
    expect(rows).toHaveLength(1);
  });

  it('trigram index on pages.title exists', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'pages' AND indexname = 'pages_title_trgm_idx'
    `;
    expect(rows).toHaveLength(1);
  });
});
```

- [x] **Step 4: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/db/system-meta-schema.test.ts
```

Expected: FAIL — missing `system_meta` table; failing assertions on extension and index.

- [x] **Step 5: Generate the migration**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  DATABASE_URL=postgres://cairn:cairn@localhost:5432/cairn pnpm db:generate
```

A new `0004_*.sql` appears, creating only the `system_meta` table (drizzle-kit can't generate extensions or non-Drizzle indexes).

- [x] **Step 6: Append extension + trigram index to the new migration**

Open `drizzle/migrations/0004_*.sql`. After the `CREATE TABLE "system_meta"` block, append:

```sql
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pages_title_trgm_idx" ON "pages" USING gin (title gin_trgm_ops);
```

- [x] **Step 7: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/db/system-meta-schema.test.ts
```

Expected: 3 passed.

- [x] **Step 8: Lint + typecheck + full suite**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck && pnpm test
```

Full suite: 77 + 3 = 80.

- [x] **Step 9: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/db/schema/ drizzle/ tests/db/system-meta-schema.test.ts && \
  git commit -m "feat: pg_trgm extension, title trigram index, system_meta table"
```

---

## Task 2: searchPages + getBreadcrumbs helpers

**Goal:** Two helpers backing the search API.

- `searchPages(workspaceId, query, limit)`: returns ranked results with `title`, `snippet` (highlighted ts_headline), and `breadcrumb` (parent chain). Combines FTS (`content_tsv @@ websearch_to_tsquery`) with a `pg_trgm` similarity fallback on `title` when FTS returns < limit rows.
- `getBreadcrumbs(pageIds, workspaceId)`: returns a map from pageId to its ordered ancestor chain (root → page), for embedding in search results.

**Files:**
- Create: `src/lib/pages/search.ts`
- Create: `tests/lib/pages/search.test.ts`

- [x] **Step 1: Write failing test `tests/lib/pages/search.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { updatePage } from '@/lib/pages/update';
import { searchPages, getBreadcrumbs } from '@/lib/pages/search';
import * as schema from '@/db/schema';
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

describe('searchPages', () => {
  it('finds a page by exact title word', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Roadmap' });
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Untitled' });
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'roadmap' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toBe('Roadmap');
  });

  it('finds a page by body text', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Note' });
    await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quokkas are wonderful' }] }],
        },
      },
    });
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'quokkas' });
    expect(results.length).toBe(1);
    expect(results[0]?.snippet?.toLowerCase()).toContain('quokk');
  });

  it('typo-tolerant: finds Roadmap with "rodmap"', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Roadmap' });
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'rodmap' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toBe('Roadmap');
  });

  it('excludes soft-deleted pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Hidden' });
    await sql`UPDATE pages SET deleted_at = now() WHERE id = ${p.id}`;
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'hidden' });
    expect(results).toEqual([]);
  });

  it('excludes pages from other workspaces', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId, title: 'Secret' });
    const results = await searchPages(db, { workspaceId: a.workspaceId, query: 'secret' });
    expect(results).toEqual([]);
  });

  it('returns at most `limit` results', async () => {
    const u = await createTestWorkspaceWithUser(db);
    for (let i = 0; i < 15; i++) {
      await createPage(db, {
        workspaceId: u.workspaceId,
        createdBy: u.userId,
        title: `Roadmap ${i}`,
      });
    }
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'roadmap', limit: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });
});

describe('getBreadcrumbs', () => {
  it('returns the ancestor chain for nested pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const mid = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'B',
    });
    const leaf = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: mid.id,
      title: 'C',
    });
    const trail = await getBreadcrumbs(db, {
      pageIds: [leaf.id],
      workspaceId: u.workspaceId,
    });
    const path = trail.get(leaf.id) ?? [];
    expect(path.map((p) => p.title)).toEqual(['A', 'B', 'C']);
  });

  it('returns an empty chain for a top-level page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const trail = await getBreadcrumbs(db, { pageIds: [root.id], workspaceId: u.workspaceId });
    expect(trail.get(root.id)).toEqual([{ id: root.id, title: 'A' }]);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/search.test.ts
```

- [x] **Step 3: Write `src/lib/pages/search.ts`**

```ts
import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type SearchResult = {
  id: string;
  title: string;
  snippet: string | null;
  rank: number;
  breadcrumb: { id: string; title: string }[];
};

export type SearchPagesInput = {
  workspaceId: string;
  query: string;
  limit?: number;
};

export async function searchPages(
  db: PostgresJsDatabase<typeof schema>,
  input: SearchPagesInput,
): Promise<SearchResult[]> {
  const limit = Math.min(input.limit ?? 20, 50);
  const q = input.query.trim();
  if (!q) return [];

  // Primary: full-text search on content_tsv. Falls back to title trigram similarity
  // if FTS returns fewer than `limit` rows.
  const rows = (await db.execute(rawSql`
    WITH fts AS (
      SELECT
        id,
        title,
        ts_rank(content_tsv, websearch_to_tsquery('english', ${q})) AS rank,
        ts_headline(
          'english',
          coalesce(content_text, ''),
          websearch_to_tsquery('english', ${q}),
          'MaxFragments=1, MaxWords=20, MinWords=5, ShortWord=2'
        ) AS snippet
      FROM pages
      WHERE workspace_id = ${input.workspaceId}
        AND deleted_at IS NULL
        AND content_tsv @@ websearch_to_tsquery('english', ${q})
      ORDER BY rank DESC
      LIMIT ${limit}
    ),
    trgm AS (
      SELECT
        id,
        title,
        similarity(title, ${q}) AS rank,
        NULL::text AS snippet
      FROM pages
      WHERE workspace_id = ${input.workspaceId}
        AND deleted_at IS NULL
        AND title % ${q}
        AND id NOT IN (SELECT id FROM fts)
      ORDER BY rank DESC
      LIMIT ${limit}
    )
    SELECT id, title, rank, snippet FROM fts
    UNION ALL
    SELECT id, title, rank, snippet FROM trgm
    LIMIT ${limit};
  `)) as unknown as { id: string; title: string; rank: number; snippet: string | null }[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const breadcrumbs = await getBreadcrumbs(db, { pageIds: ids, workspaceId: input.workspaceId });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    rank: Number(r.rank),
    breadcrumb: breadcrumbs.get(r.id) ?? [],
  }));
}

export type Breadcrumb = { id: string; title: string };

export async function getBreadcrumbs(
  db: PostgresJsDatabase<typeof schema>,
  input: { pageIds: string[]; workspaceId: string },
): Promise<Map<string, Breadcrumb[]>> {
  if (input.pageIds.length === 0) return new Map();

  // Recursive CTE: walk up from each target page to its root, collecting (target, ancestor, depth).
  const rows = (await db.execute(rawSql`
    WITH RECURSIVE ancestors AS (
      SELECT id AS target_id, id, parent_id, title, 0 AS depth
      FROM pages
      WHERE workspace_id = ${input.workspaceId}
        AND id = ANY(${rawSql.raw(`ARRAY[${input.pageIds.map((id) => `'${id}'::uuid`).join(',')}]::uuid[]`)})
      UNION ALL
      SELECT a.target_id, p.id, p.parent_id, p.title, a.depth + 1
      FROM pages p
      INNER JOIN ancestors a ON a.parent_id = p.id
      WHERE p.workspace_id = ${input.workspaceId}
    )
    SELECT target_id, id, title, depth
    FROM ancestors
    ORDER BY target_id, depth DESC;
  `)) as unknown as { target_id: string; id: string; title: string; depth: number }[];

  const result = new Map<string, Breadcrumb[]>();
  for (const row of rows) {
    const chain = result.get(row.target_id) ?? [];
    chain.push({ id: row.id, title: row.title });
    result.set(row.target_id, chain);
  }
  return result;
}
```

NOTE: the `pg_trgm` similarity operator `%` requires the `pg_trgm` extension (enabled in Task 1). The trigram index on `pages.title` accelerates `%` queries.

NOTE: building the `ANY(ARRAY[...])` clause via string concatenation is unusual — Drizzle's `rawSql` template doesn't natively splat string arrays. The `rawSql.raw()` form bypasses parameterization. **All UUIDs in `pageIds` should already be validated as UUIDs by the API layer (Zod schema)** — but as a belt-and-suspenders, the helper could validate format. The plan assumes uppercase use only with validated input (API route layer is the boundary).

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/search.test.ts
```

Expected: 8 passed (6 search + 2 breadcrumb).

If the typo-tolerance test fails because trigram similarity threshold is too high, lower it: add `set_limit(0.2)` via `SELECT set_limit(0.2)` per session, or use `% ANY (ARRAY[...])` with explicit threshold. Easier fix: replace `title % ${q}` with `similarity(title, ${q}) > 0.2`.

- [x] **Step 5: Lint + typecheck + full suite**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck && pnpm test
```

Full suite: 80 + 8 = 88.

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/search.ts tests/lib/pages/search.test.ts && \
  git commit -m "feat: searchPages (FTS + trigram fallback) and getBreadcrumbs"
```

---

## Task 3: GET /api/search?q

**Files:**
- Create: `src/app/api/search/route.ts`
- Create: `tests/api/search.test.ts`

- [x] **Step 1: Write failing test `tests/api/search.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import { getDb } from '@/db/client';
import { createPage } from '@/lib/pages/create';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: { userId: string } | null) => void };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(query: string) {
  const { GET } = await import('@/app/api/search/route');
  const res = await GET(
    new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}`),
  );
  return { status: res.status, body: await res.json() };
}

describe('GET /api/search', () => {
  it('viewer can search', async () => {
    const u = await asUser('viewer');
    await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Roadmap' });
    const r = await call('roadmap');
    expect(r.status).toBe(200);
    const body = r.body as { results: { title: string }[] };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]?.title).toBe('Roadmap');
  });

  it('unauthenticated is 401', async () => {
    const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: null) => void };
    mod.__set(null);
    const r = await call('foo');
    expect(r.status).toBe(401);
  });

  it('empty query returns empty results', async () => {
    await asUser('viewer');
    const r = await call('');
    expect(r.status).toBe(200);
    expect((r.body as { results: unknown[] }).results).toEqual([]);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/search.test.ts
```

- [x] **Step 3: Write `src/app/api/search/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { searchPages } from '@/lib/pages/search';
import { HttpError, requireRole } from '@/lib/auth/require-role';

const Query = z.object({
  q: z.string().max(200),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const url = new URL(req.url);
    const parsed = Query.parse({ q: url.searchParams.get('q') ?? '' });
    const results = await searchPages(getDb(), {
      workspaceId: ctx.workspaceId,
      query: parsed.q,
      limit: 20,
    });
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/search.test.ts
```

Expected: 3 passed.

- [x] **Step 5: Lint + typecheck + full suite**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck && pnpm test
```

Full suite: 88 + 3 = 91.

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/app/api/search/route.ts tests/api/search.test.ts && \
  git commit -m "feat: GET /api/search (viewer+, FTS + trigram fallback)"
```

---

## Task 4: ⌘K Search palette UI

**Goal:** Global keyboard shortcut opens a command palette. Typing debounces a fetch to `/api/search`. Arrow keys navigate; Enter opens; Esc closes.

**Files:**
- Create: `src/components/search-palette.tsx`
- Modify: `src/app/(app)/layout.tsx` — mount the palette
- Install: `cmdk` (the shadcn-recommended command palette primitive)

- [x] **Step 1: Install cmdk**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm add cmdk@^1.0.4
```

- [x] **Step 2: Write `src/components/search-palette.tsx`**

```tsx
'use client';

import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';

type SearchResult = {
  id: string;
  title: string;
  snippet: string | null;
  breadcrumb: { id: string; title: string }[];
};

export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Global ⌘K / Ctrl+K shortcut to open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced fetch.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { results: SearchResult[] };
          setResults(body.results);
        }
      } catch {
        // ignore aborted/network errors
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  function onSelect(id: string) {
    setOpen(false);
    setQuery('');
    router.push(`/pages/${id}` as Route);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[20vh]">
      <div className="fixed inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
      <Command
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
        shouldFilter={false}
      >
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search pages…"
          className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-80 overflow-y-auto border-t">
          {loading && (
            <div className="px-4 py-2 text-sm text-muted-foreground">Searching…</div>
          )}
          {!loading && query && results.length === 0 && (
            <div className="px-4 py-2 text-sm text-muted-foreground">No results.</div>
          )}
          {results.map((r) => (
            <Command.Item
              key={r.id}
              value={r.id}
              onSelect={() => onSelect(r.id)}
              className="cursor-pointer px-4 py-2 text-sm aria-selected:bg-accent"
            >
              <div className="font-medium">{r.title}</div>
              {r.breadcrumb.length > 1 && (
                <div className="text-xs text-muted-foreground">
                  {r.breadcrumb.slice(0, -1).map((b) => b.title).join(' / ')}
                </div>
              )}
              {r.snippet && (
                <div
                  className="mt-1 text-xs text-muted-foreground"
                  // ts_headline returns <b>...</b> wrapped match highlights; safe-ish since DB is trusted.
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              )}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
```

NOTE: `dangerouslySetInnerHTML` is used for the snippet because `ts_headline` returns `<b>` markup. The DB content is user-controlled but the `ts_headline` output only contains the tags we configure plus text drawn from the page (which the same user could already paste into a paragraph). For v0.1.0 we accept this trust boundary. A future hardening would HTML-escape the headline and re-inject the `<b>` tags from a parser.

- [x] **Step 3: Mount in `src/app/(app)/layout.tsx`**

Add the import and render alongside `KeyboardShortcuts`:

```tsx
import { SearchPalette } from '@/components/search-palette';
// ...
<div className="flex min-h-screen">
  <KeyboardShortcuts />
  <SearchPalette />
  <Sidebar workspaceId={ctx.workspaceId} />
  <main className="flex-1 p-8">{children}</main>
</div>
```

- [x] **Step 4: Build + test**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

All exit 0. Tests still 91.

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/search-palette.tsx 'src/app/(app)/layout.tsx' package.json pnpm-lock.yaml && \
  git commit -m "feat: ⌘K command palette with debounced search + breadcrumbs"
```

---

## Task 5: listTrash helper

**Goal:** Lists top-level deleted pages (`deleted_root = true`) for a workspace, ordered by `deleted_at desc`.

**Files:**
- Create: `src/lib/pages/trash.ts` (just `listTrash` for now; Task 6 + 7 add `restorePage` and `hardDeletePage`)
- Create: `tests/lib/pages/trash.test.ts`

- [x] **Step 1: Write failing test `tests/lib/pages/trash.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { listTrash } from '@/lib/pages/trash';
import * as schema from '@/db/schema';
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

describe('listTrash', () => {
  it('returns only deleted_root pages for the workspace', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'R' });
    await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'C',
    });
    await softDeletePage(db, { pageId: root.id, workspaceId: u.workspaceId });
    const trash = await listTrash(db, u.workspaceId);
    expect(trash).toHaveLength(1); // only the root, not the cascaded child
    expect(trash[0]?.title).toBe('R');
  });

  it('returns nothing when no pages are deleted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'L' });
    const trash = await listTrash(db, u.workspaceId);
    expect(trash).toEqual([]);
  });

  it('orders by deleted_at desc', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    await softDeletePage(db, { pageId: a.id, workspaceId: u.workspaceId });
    // Give a small gap so deleted_at differs.
    await new Promise((r) => setTimeout(r, 30));
    await softDeletePage(db, { pageId: b.id, workspaceId: u.workspaceId });
    const trash = await listTrash(db, u.workspaceId);
    expect(trash.map((t) => t.title)).toEqual(['B', 'A']);
  });

  it('excludes other workspaces', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId, title: 'B' });
    await softDeletePage(db, { pageId: p.id, workspaceId: b.workspaceId });
    const trash = await listTrash(db, a.workspaceId);
    expect(trash).toEqual([]);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/trash.test.ts
```

- [x] **Step 3: Write `src/lib/pages/trash.ts`**

```ts
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type TrashEntry = {
  id: string;
  title: string;
  icon: string | null;
  deletedAt: Date;
};

export async function listTrash(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<TrashEntry[]> {
  const rows = await db
    .select({
      id: schema.pages.id,
      title: schema.pages.title,
      icon: schema.pages.icon,
      deletedAt: schema.pages.deletedAt,
    })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.workspaceId, workspaceId),
        isNotNull(schema.pages.deletedAt),
        eq(schema.pages.deletedRoot, true),
      ),
    )
    .orderBy(desc(schema.pages.deletedAt));

  return rows
    .filter((r): r is typeof r & { deletedAt: Date } => r.deletedAt !== null)
    .map((r) => ({ id: r.id, title: r.title, icon: r.icon, deletedAt: r.deletedAt }));
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/trash.test.ts
```

Expected: 4 passed.

- [x] **Step 5: Lint + typecheck**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck
```

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/trash.ts tests/lib/pages/trash.test.ts && \
  git commit -m "feat: listTrash (deleted_root rows, workspace-scoped, desc)"
```

---

## Task 6: restorePage helper

**Goal:** Restore the deleted root and its cascade descendants (children whose `deleted_root = false` and whose nearest deleted ancestor is this root). After restore, `deleted_at` and `deleted_root` are cleared on all affected rows.

**Files:**
- Modify: `src/lib/pages/trash.ts` — add `restorePage`
- Create: `tests/lib/pages/restore.test.ts`

- [x] **Step 1: Write failing test `tests/lib/pages/restore.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { restorePage } from '@/lib/pages/trash';
import * as schema from '@/db/schema';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';
import { eq } from 'drizzle-orm';

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

describe('restorePage', () => {
  it('clears deleted_at on root and all cascaded descendants', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'R' });
    const child = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'C',
    });
    await softDeletePage(db, { pageId: root.id, workspaceId: u.workspaceId });
    await restorePage(db, { pageId: root.id, workspaceId: u.workspaceId });
    const rows = await db.select().from(schema.pages);
    for (const r of rows) {
      expect(r.deletedAt).toBeNull();
      expect(r.deletedRoot).toBe(false);
    }
    expect(rows).toHaveLength(2);
  });

  it('throws if the page is not in the trash (not deleted_root)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await expect(
      restorePage(db, { pageId: p.id, workspaceId: u.workspaceId }),
    ).rejects.toThrow(/not in trash/i);
  });

  it('does not restore unrelated deleted_root pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    await softDeletePage(db, { pageId: a.id, workspaceId: u.workspaceId });
    await softDeletePage(db, { pageId: b.id, workspaceId: u.workspaceId });
    await restorePage(db, { pageId: a.id, workspaceId: u.workspaceId });
    const [bRow] = await db.select().from(schema.pages).where(eq(schema.pages.id, b.id));
    expect(bRow?.deletedAt).not.toBeNull(); // B remains in trash
    expect(bRow?.deletedRoot).toBe(true);
  });

  it('rejects pages in another workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await softDeletePage(db, { pageId: p.id, workspaceId: b.workspaceId });
    await expect(
      restorePage(db, { pageId: p.id, workspaceId: a.workspaceId }),
    ).rejects.toThrow(/not in trash/i);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/restore.test.ts
```

- [x] **Step 3: Add `restorePage` to `src/lib/pages/trash.ts`**

Append after the existing `listTrash`:

```ts
import { sql as rawSql } from 'drizzle-orm';
// ... existing imports + listTrash ...

export type RestoreInput = {
  pageId: string;
  workspaceId: string;
};

export async function restorePage(
  db: PostgresJsDatabase<typeof schema>,
  input: RestoreInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    // The page must currently be the root of a soft-deleted subtree.
    const target = (await tx.execute(rawSql`
      SELECT id FROM pages
      WHERE id = ${input.pageId}
        AND workspace_id = ${input.workspaceId}
        AND deleted_at IS NOT NULL
        AND deleted_root = true
      LIMIT 1
    `)) as unknown as { id: string }[];
    if (target.length === 0) throw new Error('Page not in trash');

    // Cascade restore: every descendant whose deleted_root = false (i.e., deleted as part
    // of this same cascade — not a separately-deleted nested subtree).
    await tx.execute(rawSql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE id = ${input.pageId}
        UNION ALL
        SELECT p.id FROM pages p
        INNER JOIN descendants d ON p.parent_id = d.id
        WHERE p.deleted_at IS NOT NULL
          AND p.deleted_root = false
      )
      UPDATE pages
      SET deleted_at = NULL,
          deleted_root = false
      WHERE id IN (SELECT id FROM descendants);
    `);
  });
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/restore.test.ts
```

Expected: 4 passed.

- [x] **Step 5: Lint + typecheck + full suite**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck && pnpm test
```

Full suite: 91 + 4 = 95 (Task 5's 4 + Task 6's 4 = 8 new pages tests since the search task).

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/trash.ts tests/lib/pages/restore.test.ts && \
  git commit -m "feat: restorePage (cascade restore via deleted_root scoping)"
```

---

## Task 7: hardDeletePage helper

**Goal:** Permanent removal from `pages`. Postgres cascade FK on `parent_id` handles descendants automatically. Idempotent (no error if page is already gone).

**Files:**
- Modify: `src/lib/pages/trash.ts` — add `hardDeletePage`
- Create: `tests/lib/pages/hard-delete.test.ts`

- [x] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { hardDeletePage } from '@/lib/pages/trash';
import * as schema from '@/db/schema';
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

describe('hardDeletePage', () => {
  it('permanently removes the page and its descendants', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'R' });
    await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'C',
    });
    await softDeletePage(db, { pageId: root.id, workspaceId: u.workspaceId });
    await hardDeletePage(db, { pageId: root.id, workspaceId: u.workspaceId });
    const rows = await db.select().from(schema.pages);
    expect(rows).toEqual([]);
  });

  it('only operates on trash entries (refuses live pages)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await expect(
      hardDeletePage(db, { pageId: p.id, workspaceId: u.workspaceId }),
    ).rejects.toThrow(/not in trash/i);
  });

  it('rejects cross-workspace deletes', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await softDeletePage(db, { pageId: p.id, workspaceId: b.workspaceId });
    await expect(
      hardDeletePage(db, { pageId: p.id, workspaceId: a.workspaceId }),
    ).rejects.toThrow(/not in trash/i);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/hard-delete.test.ts
```

- [x] **Step 3: Add `hardDeletePage` to `src/lib/pages/trash.ts`**

Append:

```ts
export type HardDeleteInput = {
  pageId: string;
  workspaceId: string;
};

export async function hardDeletePage(
  db: PostgresJsDatabase<typeof schema>,
  input: HardDeleteInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const found = (await tx.execute(rawSql`
      SELECT id FROM pages
      WHERE id = ${input.pageId}
        AND workspace_id = ${input.workspaceId}
        AND deleted_at IS NOT NULL
        AND deleted_root = true
      LIMIT 1
    `)) as unknown as { id: string }[];
    if (found.length === 0) throw new Error('Page not in trash');

    await tx.execute(rawSql`
      DELETE FROM pages WHERE id = ${input.pageId}
    `);
    // The pages.parent_id FK has ON DELETE CASCADE (added in Plan 2 Task 3),
    // so descendants are removed automatically by Postgres.
  });
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/hard-delete.test.ts
```

Expected: 3 passed.

- [x] **Step 5: Lint + typecheck + full suite**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck && pnpm test
```

Full suite: 95 + 3 = 98.

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/trash.ts tests/lib/pages/hard-delete.test.ts && \
  git commit -m "feat: hardDeletePage (permanent removal, trash-only, cascade)"
```

---

## Task 8: Trash API routes

**Goal:**
- `GET /api/trash` — viewer+ — returns the trash list.
- `POST /api/pages/[pageId]/restore` — editor+ — restores.
- `DELETE /api/trash/[pageId]` — editor+ — hard deletes.

**Files:**
- Create: `src/app/api/trash/route.ts`
- Create: `src/app/api/trash/[pageId]/route.ts`
- Create: `src/app/api/pages/[pageId]/restore/route.ts`
- Create: `tests/api/trash-routes.test.ts`

- [x] **Step 1: Write failing test `tests/api/trash-routes.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import { getDb } from '@/db/client';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: { userId: string } | null) => void };
  mod.__set({ userId: u.userId });
  return u;
}

describe('trash routes', () => {
  it('GET /api/trash lists deleted_root pages for viewer', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId, title: 'X' });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { GET } = await import('@/app/api/trash/route');
    const res = await GET(new Request('http://localhost/api/trash'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { id: string }[] };
    expect(body.entries).toHaveLength(1);
  });

  it('POST /api/pages/[pageId]/restore restores as editor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { POST } = await import('@/app/api/pages/[pageId]/restore/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${p.id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ pageId: p.id }) },
    );
    expect(res.status).toBe(204);
  });

  it('POST restore: viewer is 403', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { POST } = await import('@/app/api/pages/[pageId]/restore/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${p.id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ pageId: p.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('DELETE /api/trash/[pageId] hard-deletes as editor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { DELETE } = await import('@/app/api/trash/[pageId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/trash/${p.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ pageId: p.id }) },
    );
    expect(res.status).toBe(204);
  });

  it('DELETE /api/trash/[pageId]: viewer is 403', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { DELETE } = await import('@/app/api/trash/[pageId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/trash/${p.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ pageId: p.id }) },
    );
    expect(res.status).toBe(403);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/trash-routes.test.ts
```

- [x] **Step 3: Write `src/app/api/trash/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { listTrash } from '@/lib/pages/trash';
import { HttpError, requireRole } from '@/lib/auth/require-role';

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const entries = await listTrash(getDb(), ctx.workspaceId);
    return NextResponse.json({ entries });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
```

- [x] **Step 4: Write `src/app/api/trash/[pageId]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { hardDeletePage } from '@/lib/pages/trash';
import { HttpError, requireRole } from '@/lib/auth/require-role';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { pageId } = await params;
    await hardDeletePage(getDb(), { pageId, workspaceId: ctx.workspaceId });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    if (/not in trash/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [x] **Step 5: Write `src/app/api/pages/[pageId]/restore/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { restorePage } from '@/lib/pages/trash';
import { HttpError, requireRole } from '@/lib/auth/require-role';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { pageId } = await params;
    await restorePage(getDb(), { pageId, workspaceId: ctx.workspaceId });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    if (/not in trash/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [x] **Step 6: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/trash-routes.test.ts
```

Expected: 5 passed.

- [x] **Step 7: Lint + typecheck + full suite**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck && pnpm test
```

Full suite: 98 + 5 = 103.

- [x] **Step 8: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add 'src/app/api/' tests/api/trash-routes.test.ts && \
  git commit -m "feat: trash API (list, restore, hard-delete)"
```

---

## Task 9: Trash UI

**Goal:** A `/trash` route showing the trash list with Restore + Delete-forever buttons. Sidebar gets a "Trash" link below the page tree.

**Files:**
- Create: `src/app/(app)/trash/page.tsx`
- Create: `src/components/trash-list.tsx`
- Modify: `src/components/sidebar.tsx`

- [x] **Step 1: Write `src/components/trash-list.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export type TrashItem = {
  id: string;
  title: string;
  icon: string | null;
  deletedAt: string;
};

export function TrashList({ initialItems }: { initialItems: TrashItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState<string | null>(null);

  async function restore(id: string) {
    setBusy(id);
    const res = await fetch(`/api/pages/${id}/restore`, { method: 'POST' });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      router.refresh();
    }
  }

  async function purge(id: string) {
    if (!confirm('Permanently delete? This cannot be undone.')) return;
    setBusy(id);
    const res = await fetch(`/api/trash/${id}`, { method: 'DELETE' });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      router.refresh();
    }
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground">Trash is empty.</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between rounded border px-3 py-2"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">{item.icon ?? '📄'}</span>
            <div>
              <div className="font-medium">{item.title}</div>
              <div className="text-xs text-muted-foreground">
                Deleted {new Date(item.deletedAt).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy === item.id}
              onClick={() => void restore(item.id)}
            >
              Restore
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy === item.id}
              onClick={() => void purge(item.id)}
              className="text-destructive hover:text-destructive"
            >
              Delete forever
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [x] **Step 2: Write `src/app/(app)/trash/page.tsx`**

```tsx
import { getDb } from '@/db/client';
import { listTrash } from '@/lib/pages/trash';
import { getAuthContext } from '@/lib/auth/require-role';
import { TrashList, type TrashItem } from '@/components/trash-list';
import { redirect } from 'next/navigation';

export default async function TrashPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  const entries = await listTrash(getDb(), ctx.workspaceId);
  const initialItems: TrashItem[] = entries.map((e) => ({
    id: e.id,
    title: e.title,
    icon: e.icon,
    deletedAt: e.deletedAt.toISOString(),
  }));
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-3xl font-semibold">Trash</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Items here are recoverable for 30 days, then permanently removed.
      </p>
      <TrashList initialItems={initialItems} />
    </div>
  );
}
```

- [x] **Step 3: Add Trash link to sidebar**

Read `src/components/sidebar.tsx`. Inside the footer section (above `Sign out`), add:

```tsx
import Link from 'next/link';
import { Trash } from 'lucide-react';
// ...
<Link
  href="/trash"
  className="mb-2 flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
>
  <Trash className="h-3 w-3" />
  Trash
</Link>
```

- [x] **Step 4: Build + test**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

All exit 0. Tests still 103.

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add 'src/app/(app)/trash/' src/components/trash-list.tsx src/components/sidebar.tsx && \
  git commit -m "feat: trash route and sidebar link"
```

---

## Task 10: autoPurge helper

**Goal:** Throttled, advisory-lock-coordinated purge of old trash entries. Runs at most once per hour per instance. Uses a `system_meta` row `last_purge_at` plus `pg_try_advisory_lock`.

**Files:**
- Create: `src/lib/pages/auto-purge.ts`
- Create: `tests/lib/pages/auto-purge.test.ts`

- [x] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { autoPurge } from '@/lib/pages/auto-purge';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, system_meta RESTART IDENTITY CASCADE`;
});

describe('autoPurge', () => {
  it('deletes pages whose deleted_at is older than retention', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(db, { pageId: p.id, workspaceId: u.workspaceId });
    await sql`UPDATE pages SET deleted_at = now() - interval '31 days' WHERE id = ${p.id}`;

    const purged = await autoPurge(db, { retentionDays: 30 });
    expect(purged).toBeGreaterThan(0);
    const remaining = await db.select().from(schema.pages);
    expect(remaining).toEqual([]);
  });

  it('does NOT touch pages within the retention window', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(db, { pageId: p.id, workspaceId: u.workspaceId });
    // deleted now, well within 30-day window
    const purged = await autoPurge(db, { retentionDays: 30 });
    expect(purged).toBe(0);
    const remaining = await db.select().from(schema.pages);
    expect(remaining).toHaveLength(1);
  });

  it('is a no-op when last purge was less than 1 hour ago', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(db, { pageId: p.id, workspaceId: u.workspaceId });
    await sql`UPDATE pages SET deleted_at = now() - interval '31 days' WHERE id = ${p.id}`;

    // Seed last_purge_at to "now" so the throttle short-circuits.
    await sql`
      INSERT INTO system_meta (key, value)
      VALUES ('last_purge_at', now()::text)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
    `;

    const purged = await autoPurge(db, { retentionDays: 30 });
    expect(purged).toBe(0);
    const remaining = await db.select().from(schema.pages);
    expect(remaining).toHaveLength(1); // still there
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/auto-purge.test.ts
```

- [x] **Step 3: Write `src/lib/pages/auto-purge.ts`**

```ts
import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

const ADVISORY_LOCK_KEY = 712491; // arbitrary stable int
const THROTTLE_SECONDS = 60 * 60; // 1 hour

export type AutoPurgeInput = {
  retentionDays: number;
};

/**
 * Opportunistic, throttled purge of soft-deleted pages older than retentionDays.
 *
 * - Uses pg_try_advisory_lock so only one process at a time runs the query.
 * - Reads system_meta.last_purge_at; if updated within the last hour, returns 0.
 * - On success: deletes expired rows (FK cascade removes descendants), updates last_purge_at.
 *
 * Returns the number of rows deleted (0 if throttled, skipped, or nothing to purge).
 */
export async function autoPurge(
  db: PostgresJsDatabase<typeof schema>,
  input: AutoPurgeInput,
): Promise<number> {
  return db.transaction(async (tx) => {
    const lockRows = (await tx.execute(rawSql`
      SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS acquired
    `)) as unknown as { acquired: boolean }[];
    if (!lockRows[0]?.acquired) return 0;

    const meta = (await tx.execute(rawSql`
      SELECT value FROM system_meta WHERE key = 'last_purge_at' LIMIT 1
    `)) as unknown as { value: string }[];

    if (meta[0]?.value) {
      const last = new Date(meta[0].value);
      if (!Number.isNaN(last.getTime())) {
        const ageSec = (Date.now() - last.getTime()) / 1000;
        if (ageSec < THROTTLE_SECONDS) return 0;
      }
    }

    // Only operates on rows whose deleted_root = true to keep the join small and
    // let FK cascade remove descendants.
    const result = (await tx.execute(rawSql`
      WITH purged AS (
        DELETE FROM pages
        WHERE deleted_at IS NOT NULL
          AND deleted_root = true
          AND deleted_at < now() - (${input.retentionDays} * interval '1 day')
        RETURNING id
      )
      SELECT count(*)::int AS count FROM purged
    `)) as unknown as { count: number }[];

    await tx.execute(rawSql`
      INSERT INTO system_meta (key, value)
      VALUES ('last_purge_at', now()::text)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
    `);

    return Number(result[0]?.count ?? 0);
  });
}
```

NOTE: `pg_try_advisory_xact_lock` is released automatically at transaction commit/rollback, no manual unlock needed.

NOTE: `(${input.retentionDays} * interval '1 day')` may need explicit casting if Drizzle's parameter binding inserts as text — adjust to `${input.retentionDays}::int * interval '1 day'` if the SQL errors at runtime.

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/auto-purge.test.ts
```

Expected: 3 passed.

- [x] **Step 5: Lint + typecheck + full suite**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck && pnpm test
```

Full suite: 103 + 3 = 106.

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/auto-purge.ts tests/lib/pages/auto-purge.test.ts && \
  git commit -m "feat: autoPurge with advisory-lock + 1h throttle"
```

---

## Task 11: Wire autoPurge into API requests

**Goal:** Call `autoPurge` fire-and-forget from page-related routes so that any active workspace eventually purges. Uses `env().CAIRN_TRASH_RETENTION_DAYS`.

The simplest hook is at the top of the trash routes: each time the user opens trash or hits a page route, kick off a non-awaited `autoPurge`. The advisory lock makes concurrent calls safe, and the throttle keeps load bounded.

**Files:**
- Modify: `src/app/api/trash/route.ts` — add fire-and-forget purge call
- Modify: `src/app/api/pages/route.ts` — add fire-and-forget purge call
- Optionally create a small helper `src/lib/pages/maybe-purge.ts`

- [x] **Step 1: Write `src/lib/pages/maybe-purge.ts`**

```ts
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { autoPurge } from './auto-purge';

/** Fire-and-forget; failures are logged but do not throw. */
export function maybePurge(): void {
  void autoPurge(getDb(), { retentionDays: env().CAIRN_TRASH_RETENTION_DAYS }).catch((err) => {
    // biome-ignore lint/suspicious/noConsoleLog: ops visibility into purge failures
    console.error('autoPurge failed:', err);
  });
}
```

- [x] **Step 2: Wire into existing routes**

In `src/app/api/trash/route.ts`, at the top of `GET`:

```ts
import { maybePurge } from '@/lib/pages/maybe-purge';
// ...
export async function GET(): Promise<Response> {
  maybePurge();
  // ...rest of existing handler
}
```

In `src/app/api/pages/route.ts` (the POST handler), at the top:

```ts
import { maybePurge } from '@/lib/pages/maybe-purge';
// ...
export async function POST(req: Request): Promise<Response> {
  maybePurge();
  // ...rest of existing handler
}
```

- [x] **Step 3: Run all tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test
```

Full suite still 106 (no new tests; existing API tests should keep passing — `maybePurge` is non-awaited and the advisory lock will release without affecting the test's main transaction).

- [x] **Step 4: Lint + typecheck**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck
```

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/maybe-purge.ts 'src/app/api/' && \
  git commit -m "feat: fire-and-forget autoPurge from pages + trash routes"
```

---

## Task 12: E2E smoke + CHANGELOG

- [x] **Step 1: Full E2E smoke**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  docker compose down -v 2>/dev/null || true && \
  docker compose up -d --build && \
  sleep 20
```

Wait until cairn is healthy. Then exercise:

1. Sign up:
   ```sh
   curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/signup \
     -H 'content-type: application/json' \
     -d '{"email":"test@example.com","password":"correct horse battery","name":"Test","workspaceName":"Test Lab"}'
   ```
2. Sign in via Auth.js callback (using csrf token + cookie jar; same pattern as Plan 2 Task 25).
3. Create a page, set title to "Roadmap planning", add some content.
4. Search "roadmap" → expect 1+ result with the page.
5. Search "rdmap" (typo) → expect the same page in results (trigram fallback).
6. Delete the page → trash list shows it; GET /api/trash returns it.
7. Restore the page → trash list empty; original page reappears in sidebar.
8. Delete again, then hard-delete from trash → permanently gone.
9. Browser: open `/`, press ⌘K, type "roadmap" — palette shows results.
10. Open `/trash`, verify Restore and Delete-forever buttons.

If a step fails, debug. Common gotchas:
- `pg_trgm` extension creation requires Postgres superuser inside the docker container — `postgres:16-alpine` runs `CREATE EXTENSION` with superuser by default, fine.
- ⌘K only works in `(app)/...` routes (the layout mounts SearchPalette).

- [x] **Step 2: Tear down**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && docker compose down
```

- [x] **Step 3: Update `CHANGELOG.md`**

Add under `[Unreleased]` above the existing entries:

```markdown
### Added (Plan 3 — Search & trash)
- Postgres full-text search with `pg_trgm` trigram fallback for typo-tolerant title matching.
- `searchPages` helper returning snippets (`ts_headline`) and breadcrumbs.
- `GET /api/search` route (viewer+, workspace-scoped).
- ⌘K command palette with debounced query, arrow nav, breadcrumb path display.
- Trash bin: `listTrash`, `restorePage` (cascade-aware via `deleted_root`), `hardDeletePage`.
- Trash API: `GET /api/trash`, `POST /api/pages/[pageId]/restore`, `DELETE /api/trash/[pageId]`.
- `/trash` route with Restore + Delete-forever actions.
- `autoPurge` with `pg_try_advisory_xact_lock` and 1-hour throttle; fired opportunistically from trash and pages routes.
- `system_meta` key/value table for cross-process flags (currently: `last_purge_at`).
```

- [x] **Step 4: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add CHANGELOG.md && \
  git commit -m "docs: changelog entry for search & trash (Plan 3)"
```

---

## Done

After this plan:
- ⌘K opens a global search palette; finds pages by title or body, tolerates typos, shows breadcrumbs.
- Soft-deleted pages live in `/trash` with restore + permanent-delete actions.
- Stale trash entries auto-purge once an hour (per instance) without a separate worker.

**Next plan:** `2026-MM-DD-cairn-files-and-markdown.md` — local-disk uploads, image + file blocks in the editor, cover images, markdown import/export.
