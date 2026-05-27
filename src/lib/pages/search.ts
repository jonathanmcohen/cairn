import { sql as rawSql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export type SearchFilters = {
  author?: string;
  dateRange?: { from?: string; to?: string };
  /**
   * Reserved: future pages+db_rows union search would split results by source.
   * The current search only covers `pages`, so this is accepted but no SQL is emitted.
   */
  types?: ('page' | 'db_row')[];
  /**
   * Reserved: see `types` — the pages table has no database_id link column,
   * so this is accepted but inert. Kept in the type so saved_searches.filters
   * jsonb can store the full vocabulary.
   */
  scopeDatabaseId?: string;
};

/**
 * Compile structured search filters into SQL fragments that AND onto the
 * FTS / trigram WHERE clauses. Pure + config-only — no schema change.
 * Every interpolated id is UUID-validated to defend the raw-SQL boundary
 * (mirrors getBreadcrumbs).
 */
export function compileSearchFilters(filters: SearchFilters): SQL[] {
  const frags: SQL[] = [];
  if (filters.author) {
    if (!UUID_RE.test(filters.author)) {
      throw new Error(`invalid author uuid: ${filters.author}`);
    }
    frags.push(rawSql`created_by = ${filters.author}::uuid`);
  }
  if (filters.dateRange?.from) {
    frags.push(rawSql`created_at >= ${filters.dateRange.from}::timestamptz`);
  }
  if (filters.dateRange?.to) {
    frags.push(rawSql`created_at <= ${filters.dateRange.to}::timestamptz`);
  }
  // `types` and `scopeDatabaseId` accepted but currently no-op (see type docs).
  return frags;
}

export type SearchResult = {
  id: string;
  title: string;
  snippet: string | null;
  rank: number;
  breadcrumb: { id: string; title: string }[];
};

export type SearchMode = 'fts' | 'semantic' | 'hybrid';

export type SearchPagesInput = {
  workspaceId: string;
  query: string;
  limit?: number;
  filters?: SearchFilters;
  /** Selects the underlying retrieval strategy. Defaults to `'fts'` for full
   * backward compatibility with v0.6 callers. */
  mode?: SearchMode;
};

/**
 * Existing FTS + trigram path, extracted into a private function so the
 * top-level dispatch can pick this OR semantic OR hybrid. Returns rows
 * WITHOUT breadcrumbs — the dispatcher resolves them once across whatever
 * mode produced the ids.
 */
async function searchFts(
  db: PostgresJsDatabase<typeof schema>,
  input: SearchPagesInput,
): Promise<SearchResult[]> {
  const limit = Math.min(input.limit ?? 20, 50);
  const q = input.query.trim();
  if (!q) return [];

  // Build extra WHERE fragment (or `true` when no filters).
  const extraFrags = compileSearchFilters(input.filters ?? {});
  const extra =
    extraFrags.length === 0 ? rawSql`true` : extraFrags.reduce((acc, f) => rawSql`${acc} AND ${f}`);

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
        AND encrypted = false
        AND status NOT IN ('draft','archived')
        AND content_tsv @@ websearch_to_tsquery('english', ${q})
        AND ${extra}
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
        AND encrypted = false
        AND status NOT IN ('draft','archived')
        AND similarity(title, ${q}) > 0.2
        AND id NOT IN (SELECT id FROM fts)
        AND ${extra}
      ORDER BY rank DESC
      LIMIT ${limit}
    )
    SELECT id, title, rank, snippet FROM fts
    UNION ALL
    SELECT id, title, rank, snippet FROM trgm
    LIMIT ${limit};
  `)) as unknown as { id: string; title: string; rank: number; snippet: string | null }[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    rank: Number(r.rank),
    breadcrumb: [],
  }));
}

/**
 * Semantic kNN — embeds the query via the P11 provider, then runs a
 * pgvector cosine-distance nearest-neighbor lookup against the workspace's
 * page_embeddings rows.
 *
 * The embedding provider is dynamically imported so that callers using only
 * `mode: 'fts'` don't pay the ORT/transformers import cost.
 */
async function searchSemantic(
  db: PostgresJsDatabase<typeof schema>,
  input: SearchPagesInput,
): Promise<SearchResult[]> {
  const limit = Math.min(input.limit ?? 20, 50);
  const q = input.query.trim();
  if (!q) return [];

  const { getEmbeddingProvider } = await import('@/lib/search/embed');
  const provider = getEmbeddingProvider();
  const vec = await provider.embed(q);
  const vecLiteral = `[${Array.from(vec).join(',')}]`;

  // <=> is pgvector's cosine-distance operator; ORDER BY ... ASC gives
  // nearest-first. We don't apply the SearchFilters here yet (date range /
  // author) — workspace_id + deleted_at IS NULL is the v0.7 surface; the
  // filter-compile reuse can come in a follow-up if real usage demands it.
  const rows = (await db.execute(rawSql`
    SELECT p.id AS id, p.title AS title,
           (e.embedding <=> ${vecLiteral}::vector) AS distance
    FROM page_embeddings e
    JOIN pages p ON p.id = e.page_id
    WHERE e.workspace_id = ${input.workspaceId}
      AND p.deleted_at IS NULL
      AND p.encrypted = false
      AND p.status NOT IN ('draft','archived')
    ORDER BY e.embedding <=> ${vecLiteral}::vector ASC
    LIMIT ${limit}
  `)) as unknown as { id: string; title: string; distance: number }[];

  // Convert cosine distance → rank score (1 - distance, clamped). The bigger,
  // the more relevant; this mirrors the FTS path's "higher rank is better".
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: null,
    rank: Math.max(0, 1 - Number(r.distance)),
    breadcrumb: [],
  }));
}

/**
 * Hybrid retrieval — runs FTS and semantic in parallel with a fanout
 * (4×limit) larger than the final cap so RRF has room to combine. Pages in
 * both rankings score higher than pages in either alone.
 */
async function searchHybrid(
  db: PostgresJsDatabase<typeof schema>,
  input: SearchPagesInput,
): Promise<SearchResult[]> {
  const limit = Math.min(input.limit ?? 20, 50);
  const fanout = limit * 4;
  const [fts, sem] = await Promise.all([
    searchFts(db, { ...input, limit: fanout }),
    searchSemantic(db, { ...input, limit: fanout }),
  ]);

  const ftsRanking = fts.map((r, i) => ({ id: r.id, rank: i + 1 }));
  const semRanking = sem.map((r, i) => ({ id: r.id, rank: i + 1 }));
  const merged = combineWithRrf([ftsRanking, semRanking], { limit });

  // Re-join the merged ids back to the original SearchResult shape — prefer
  // the FTS-side row (it has a snippet) when available, else the semantic row.
  const byId = new Map<string, SearchResult>();
  for (const r of fts) byId.set(r.id, r);
  for (const r of sem) if (!byId.has(r.id)) byId.set(r.id, r);

  return merged
    .map((m) => {
      const row = byId.get(m.id);
      return row ? { ...row, rank: m.rrfScore } : undefined;
    })
    .filter((r): r is SearchResult => Boolean(r));
}

export async function searchPages(
  db: PostgresJsDatabase<typeof schema>,
  input: SearchPagesInput,
): Promise<SearchResult[]> {
  const mode: SearchMode = input.mode ?? 'fts';
  let rows: SearchResult[];
  if (mode === 'fts') rows = await searchFts(db, input);
  else if (mode === 'semantic') rows = await searchSemantic(db, input);
  else if (mode === 'hybrid') rows = await searchHybrid(db, input);
  else throw new Error(`Unknown search mode: ${String(mode)}`);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const breadcrumbs = await getBreadcrumbs(db, { pageIds: ids, workspaceId: input.workspaceId });
  return rows.map((r) => ({ ...r, breadcrumb: breadcrumbs.get(r.id) ?? [] }));
}

// ── RRF combiner ───────────────────────────────────────────────────────────

export type RrfRankedItem = { id: string; rank: number };
export type RrfOpts = { k?: number; limit?: number };
export type RrfResult = { id: string; rrfScore: number };

/**
 * Reciprocal Rank Fusion combiner. For each ranking list r, each item's
 * contribution is 1 / (k + rank), where rank is 1-indexed (1 = best). An
 * item's combined score is the sum of its contributions across rankings;
 * items absent from a ranking contribute 0 from it. k=60 is the standard
 * default (Cormack/Clarke/Buettcher 2009). The output is sorted by
 * rrfScore DESC, ties broken by id ASC for determinism.
 *
 * Pure — no DB, no provider. Used by searchHybrid to merge FTS + semantic.
 */
export function combineWithRrf(rankings: RrfRankedItem[][], opts: RrfOpts = {}): RrfResult[] {
  const k = opts.k ?? 60;
  const acc = new Map<string, number>();
  for (const ranking of rankings) {
    for (const item of ranking) {
      acc.set(item.id, (acc.get(item.id) ?? 0) + 1 / (k + item.rank));
    }
  }
  const merged: RrfResult[] = [...acc.entries()].map(([id, rrfScore]) => ({ id, rrfScore }));
  merged.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    return a.id.localeCompare(b.id);
  });
  return opts.limit !== undefined ? merged.slice(0, opts.limit) : merged;
}

export type Breadcrumb = { id: string; title: string };

export async function getBreadcrumbs(
  db: PostgresJsDatabase<typeof schema>,
  input: { pageIds: string[]; workspaceId: string },
): Promise<Map<string, Breadcrumb[]>> {
  if (input.pageIds.length === 0) return new Map();

  // Build a safe SQL array literal of UUIDs. Validate each is a plain UUID string
  // to defend against injection — though API callers should already validate.
  for (const id of input.pageIds) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error(`invalid uuid in pageIds: ${id}`);
    }
  }
  const arrayLiteral = `ARRAY[${input.pageIds.map((id) => `'${id}'::uuid`).join(',')}]::uuid[]`;

  const rows = (await db.execute(rawSql`
    WITH RECURSIVE ancestors AS (
      SELECT id AS target_id, id, parent_id, title, 0 AS depth
      FROM pages
      WHERE workspace_id = ${input.workspaceId}
        AND id = ANY(${rawSql.raw(arrayLiteral)})
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
