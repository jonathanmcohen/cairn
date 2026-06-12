import { sql as rawSql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { computeContentHash, embedPage } from '@/lib/search/embed-page';

type Db = PostgresJsDatabase<typeof schema>;

export type ReindexSummary = {
  processed: number;
  embedded: number;
  skipped: number;
  errors: number;
};

export type ReindexOpts = {
  /** Restrict to one workspace; if undefined, walks every workspace. */
  workspaceId?: string;
  /** Embed batch size; defaults to 16 (matches the parallelism budget). */
  batchSize?: number;
};

/**
 * Walk every page where the embedding is missing OR stale, embed in
 * batches of 16, log progress, return counters. Idempotent — re-running
 * after a clean pass returns {processed: 0, embedded: 0, skipped: 0}.
 *
 * Candidate selection is done in Node (id + content_text fetched, hash
 * computed locally, compared against the stored content_hash) because the
 * project's Postgres image does not enable `pgcrypto` (gen_random_uuid is
 * native in pg16 — pgcrypto's digest() is not installed). This is fine for
 * the expected backfill scale (thousands of pages, not millions).
 *
 * v0.7.0 G4 P12.
 */
export async function reindexEmbeddings(db: Db, opts: ReindexOpts = {}): Promise<ReindexSummary> {
  const batchSize = opts.batchSize ?? 16;
  const summary: ReindexSummary = { processed: 0, embedded: 0, skipped: 0, errors: 0 };

  // Pull candidates: pages whose embedding is missing OR whose content hash
  // doesn't match the stored content_hash. We compute the hash in Node.
  const rows = (await db.execute(rawSql`
    SELECT p.id AS id,
           coalesce(p.content_text, '') AS content_text,
           e.content_hash AS stored_hash
    FROM pages p
    LEFT JOIN page_embeddings e ON e.page_id = p.id
    WHERE p.deleted_at IS NULL
      ${opts.workspaceId ? rawSql`AND p.workspace_id = ${opts.workspaceId}::uuid` : rawSql``}
    ORDER BY p.workspace_id, p.id
  `)) as unknown as { id: string; content_text: string; stored_hash: string | null }[];

  const candidates: string[] = [];
  for (const r of rows) {
    const hash = computeContentHash(r.content_text);
    if (r.stored_hash !== hash) candidates.push(r.id);
  }

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map((id) => embedPage(db, id)));
    for (const r of results) {
      summary.processed++;
      if (r.status === 'rejected') {
        summary.errors++;
        // Best-effort: log to stderr; the CLI driver logs the final summary too.
        console.warn('reindex error:', r.reason);
        continue;
      }
      if (r.value.status === 'embedded') summary.embedded++;
      else if (r.value.status === 'skipped') summary.skipped++;
      // 'missing' status counts as processed but neither embedded nor skipped.
    }
    if ((i + batchSize) % 64 === 0 || i + batchSize >= candidates.length) {
      // biome-ignore lint/suspicious/noConsole: cli progress
      console.log(
        `reindex: ${summary.processed}/${candidates.length} processed ` +
          `(embedded=${summary.embedded}, skipped=${summary.skipped}, errors=${summary.errors})`,
      );
    }
  }

  return summary;
}

/**
 * CLI wrapper — builds its own postgres connection from DATABASE_URL,
 * runs reindexEmbeddings, and closes the connection. Mirrors the pattern
 * used by `src/lib/quotas/reconcile-cli.ts#reconcileAll`.
 */
export async function runReindexEmbeddingsCli(opts: ReindexOpts = {}): Promise<ReindexSummary> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for reindex-embeddings');
  const sql = postgres(url);
  try {
    const db = drizzle(sql, { schema });
    return await reindexEmbeddings(db, opts);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
