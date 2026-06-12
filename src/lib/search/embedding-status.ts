import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import { computeContentHash } from '@/lib/search/embed-page';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * v0.10.2 P18 — "still indexing" count for the search palette.
 *
 * Embedding is fire-and-forget (setImmediate per page write, no durable
 * queue), so "pending" can only be computed on demand: pages whose
 * `page_embeddings` row is MISSING or whose stored `content_hash` is STALE.
 * The selection mirrors `reindexEmbeddings` in reindex-cli.ts — candidates
 * are pulled with a LEFT JOIN and the hash is computed in Node via the same
 * `computeContentHash` that embedPage writes with (the project's Postgres
 * image lacks pgcrypto's digest(), so SQL-side hashing isn't available).
 *
 * Encrypted pages are EXCLUDED: embedPage fails closed on `encrypted=true`
 * and never writes an embedding row, so counting them would pin the
 * indicator at a permanent nonzero for any workspace with E2E pages — they
 * are "never indexable", not "still indexing".
 */
export async function countPendingEmbeddings(db: Db, workspaceId: string): Promise<number> {
  const rows = (await db.execute(rawSql`
    SELECT coalesce(p.content_text, '') AS content_text,
           e.content_hash AS stored_hash
    FROM pages p
    LEFT JOIN page_embeddings e ON e.page_id = p.id
    WHERE p.deleted_at IS NULL
      AND p.encrypted = false
      AND p.workspace_id = ${workspaceId}::uuid
  `)) as unknown as { content_text: string; stored_hash: string | null }[];

  let pending = 0;
  for (const r of rows) {
    if (r.stored_hash !== computeContentHash(r.content_text)) pending++;
  }
  return pending;
}
