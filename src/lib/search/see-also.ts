import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import { resolveEffectivePermission } from '@/lib/pages/acl';

type Db = PostgresJsDatabase<typeof schema>;

export type RelatedPage = {
  id: string;
  title: string;
  icon: string | null;
  snippet: string;
  /** 1 - cosine_distance; higher = more similar. Always in [0, 1]. */
  score: number;
  /**
   * v0.9.9 F6 (#40/#219) — min-max rescaled score across THIS result set, in
   * [0, 1]. The most-similar neighbor is 1, the least-similar is 0. Surfaces a
   * visible difference even when absolute cosines cluster in a narrow band.
   */
  relativeScore: number;
};

export type FindRelatedPagesInput = {
  /** The source page whose neighbors we want. */
  pageId: string;
  /** Signed-in viewer (gates by ACL). null + publicViewer=true skips the ACL. */
  viewerUserId: string | null;
  /** When true, the caller is rendering /p/<slug> — ACL is bypassed. */
  publicViewer?: boolean;
  /** Max items returned (defaults 5; capped at 20). */
  limit?: number;
};

const SNIPPET_LEN = 140;

/**
 * Find the N most-similar pages to `pageId` via pgvector cosine distance.
 *
 * Filters (load-bearing — see spec §4 runtime impact + §5 risk #1):
 *   - source page excluded from the result.
 *   - pages with `encrypted=true` excluded (key consumer-check; server is
 *     blind to ciphertext so similarity has no meaning).
 *   - deleted pages excluded.
 *   - draft/archived excluded (when `pages.status` column exists — gracefully
 *     skipped when P26 hasn't landed).
 *   - ACL: caller's `resolveEffectivePermission` must be non-null per
 *     candidate. publicViewer=true bypasses ACL (route already gated by
 *     pages.published + public_slug).
 */
export async function findRelatedPages(
  db: Db,
  input: FindRelatedPagesInput,
): Promise<RelatedPage[]> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);

  // 1. Fetch source page's embedding + workspace. If no embedding row, return
  //    [] — page hasn't been indexed yet (or is encrypted and won't be).
  const sourceRows = (await db.execute(rawSql`
    SELECT p.workspace_id AS workspace_id, e.embedding::text AS embedding
    FROM pages p
    LEFT JOIN page_embeddings e ON e.page_id = p.id
    WHERE p.id = ${input.pageId}
    LIMIT 1
  `)) as unknown as Array<{ workspace_id: string | null; embedding: string | null }>;

  const sourceRow = sourceRows[0];
  if (!sourceRow?.workspace_id || !sourceRow.embedding) return [];

  // 2. Detect whether `pages.status` exists (P26 may not have landed yet).
  //    Cached at module-evaluation time via a one-shot information_schema query.
  const hasStatus = await columnExists(db, 'pages', 'status');

  // 3. kNN — over-fetch (limit * 3) so we can ACL-filter and still hit `limit`
  //    visible rows in the common case.
  const candidateLimit = Math.min(limit * 3, 60);
  const statusFilter = hasStatus ? rawSql`AND p.status NOT IN ('draft', 'archived')` : rawSql``;

  const rows = (await db.execute(rawSql`
    SELECT
      p.id AS id,
      p.title AS title,
      p.icon AS icon,
      LEFT(p.content_text, ${SNIPPET_LEN}) AS snippet,
      (e.embedding <=> ${sourceRow.embedding}::vector) AS distance
    FROM page_embeddings e
    JOIN pages p ON p.id = e.page_id
    WHERE e.workspace_id = ${sourceRow.workspace_id}
      AND p.deleted_at IS NULL
      AND p.encrypted = false
      AND p.id <> ${input.pageId}
      ${statusFilter}
    ORDER BY e.embedding <=> ${sourceRow.embedding}::vector ASC
    LIMIT ${candidateLimit}
  `)) as unknown as Array<{
    id: string;
    title: string;
    icon: string | null;
    snippet: string;
    distance: string | number;
  }>;

  // 4. ACL filter (skipped on the public-reader path — the route already
  //    gates pages.published + public_slug + (with P26) status='published').
  const out: RelatedPage[] = [];
  for (const r of rows) {
    if (out.length === limit) break;
    if (!input.publicViewer) {
      if (!input.viewerUserId) continue;
      const perm = await resolveEffectivePermission(db, {
        userId: input.viewerUserId,
        pageId: r.id,
      });
      if (perm === null) continue;
    }
    out.push({
      id: r.id,
      title: r.title,
      icon: r.icon,
      snippet: r.snippet ?? '',
      score: Math.max(0, Math.min(1, 1 - Number(r.distance))),
      relativeScore: 0, // filled below after the full set is known
    });
  }

  // v0.9.9 F6 (#40/#219) — min-max rescale the absolute scores across the
  // returned set so the panel differentiates neighbors even when cosines
  // cluster. A single result (or all-equal) maps to 1.
  if (out.length > 0) {
    const scores = out.map((o) => o.score);
    const lo = Math.min(...scores);
    const hi = Math.max(...scores);
    for (const o of out) o.relativeScore = hi === lo ? 1 : (o.score - lo) / (hi - lo);
  }
  return out;
}

/**
 * Cheap one-shot information_schema lookup. Cached in a Map keyed by
 * `${table}.${column}` so the helper doesn't pay the round-trip per call —
 * schema doesn't change inside a process lifetime.
 */
const COLUMN_CACHE = new Map<string, boolean>();
async function columnExists(db: Db, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = COLUMN_CACHE.get(key);
  if (cached !== undefined) return cached;
  const rows = (await db.execute(rawSql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
    LIMIT 1
  `)) as unknown as Array<{ '?column?'?: number }>;
  const exists = rows.length > 0;
  COLUMN_CACHE.set(key, exists);
  return exists;
}
