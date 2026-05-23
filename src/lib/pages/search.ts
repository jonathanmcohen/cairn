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

export type SearchPagesInput = {
  workspaceId: string;
  query: string;
  limit?: number;
  filters?: SearchFilters;
};

export async function searchPages(
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
