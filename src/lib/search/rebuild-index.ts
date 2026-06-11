import { randomUUID } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type * as schema from '@/db/schema';
import { type ReindexOpts, type ReindexSummary, reindexEmbeddings } from '@/lib/search/reindex-cli';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * v0.10.0 D8 — pgvector index rebuild.
 *
 * The HNSW index (`page_embeddings_embedding_hnsw_idx`, created in migration
 * 0025) is never REINDEXed by anything: recovering from index bloat or
 * corruption used to require manual psql. This module adds the missing
 * operation as a two-phase background job:
 *
 *   phase 'vectors' — reindexEmbeddings (refreshes stale embedding DATA;
 *                     per-page embed failures are summarized, never fatal)
 *   phase 'index'   — REINDEX INDEX CONCURRENTLY on the HNSW index itself
 *
 * CONCURRENTLY keeps search answering throughout: reads use the old index
 * until the rebuilt one swaps in, and the FTS arm of the search union never
 * touches pgvector at all.
 */

export type RebuildJobState = 'running' | 'done' | 'error';

export type RebuildJob = {
  id: string;
  state: RebuildJobState;
  startedAt: string;
  finishedAt: string | null;
  /** Which pass is (or was last) executing — names the failing pass on error. */
  phase: 'vectors' | 'index' | null;
  /** Summary of the embedding-data pass; null until that pass completes. */
  vectors: ReindexSummary | null;
  error: string | null;
};

/**
 * The job registry lives on `globalThis`, NOT at module scope: Next compiles
 * each route handler into its own bundle, so a module-level variable could be
 * instantiated once per bundle and the GET route would never see the job the
 * POST route started. One Node process ⇒ one `globalThis` ⇒ one registry —
 * same rule as src/lib/backups/maintenance.ts. Per-process caveat applies:
 * with multiple app replicas only the replica that started the rebuild
 * reports it.
 */
const globalStore = globalThis as typeof globalThis & {
  __cairnVectorRebuildJob?: RebuildJob;
};

export const HNSW_INDEX_NAME = 'page_embeddings_embedding_hnsw_idx';

/**
 * REINDEX INDEX CONCURRENTLY on the HNSW index.
 *
 * CRITICAL: `REINDEX ... CONCURRENTLY` cannot run inside a transaction block
 * (Postgres error 25001). postgres-js executes one-off queries outside any
 * transaction by default — exactly what we need — so this must NEVER be
 * wrapped in `sql.begin()`. A dedicated `{max: 1}` connection (rather than
 * the app pool) keeps the long-running REINDEX from pinning one of the
 * pool's shared slots, and `finally` guarantees it's closed either way.
 */
export async function rebuildVectorIndex(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql.unsafe(`REINDEX INDEX CONCURRENTLY ${HNSW_INDEX_NAME}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export type StartRebuildJobOpts = {
  connectionString: string;
  db: Db;
  /** Restrict the vectors pass to one workspace; default walks all of them. */
  workspaceId?: string;
  /** Test seam — defaults to the real reindexEmbeddings pass. */
  runVectors?: (db: Db, opts: ReindexOpts) => Promise<ReindexSummary>;
  /** Test seam — defaults to the real rebuildVectorIndex pass. */
  runIndex?: (connectionString: string) => Promise<void>;
};

/**
 * Start the two-phase rebuild as a fire-and-forget async runner, or return
 * the already-running job (debounce contract: at most one rebuild per
 * process; `started: false` tells the route to answer 200 instead of 202).
 *
 * Per-page embed failures inside the vectors pass are SUMMARIZED in
 * `vectors.errors` (reindexEmbeddings never rejects for them — e.g. the
 * local model files being absent) and the run proceeds to the index pass.
 * Only a thrown error (vectors pass infrastructure failure, or REINDEX
 * itself failing) flips the job to 'error'.
 */
export function startRebuildJob(opts: StartRebuildJobOpts): { job: RebuildJob; started: boolean } {
  const current = globalStore.__cairnVectorRebuildJob;
  if (current && current.state === 'running') {
    return { job: current, started: false };
  }

  const job: RebuildJob = {
    id: randomUUID(),
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    phase: 'vectors',
    vectors: null,
    error: null,
  };
  globalStore.__cairnVectorRebuildJob = job;

  const runVectors = opts.runVectors ?? reindexEmbeddings;
  const runIndex = opts.runIndex ?? rebuildVectorIndex;

  // Deliberately NOT awaited — the route answers 202 immediately and the
  // poller (GET) watches the job settle.
  void (async () => {
    try {
      job.vectors = await runVectors(opts.db, { workspaceId: opts.workspaceId });
      job.phase = 'index';
      await runIndex(opts.connectionString);
      job.state = 'done';
    } catch (err) {
      job.state = 'error';
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  })();

  return { job, started: true };
}

/** Current/last job — doubles as the "last run" record for the admin card. */
export function getRebuildJob(): RebuildJob | null {
  return globalStore.__cairnVectorRebuildJob ?? null;
}

/** Test-only: clear the registry so each test starts from "never run". */
export function __resetRebuildJobForTests(): void {
  globalStore.__cairnVectorRebuildJob = undefined;
}

/**
 * CLI wrapper for `cli reindex-vector-index` — runs ONLY the index pass
 * (operators wanting the data pass too run `reindex-embeddings` first).
 * Builds its own connection from DATABASE_URL, mirroring
 * runReindexEmbeddingsCli.
 */
export async function runRebuildVectorIndexCli(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for reindex-vector-index');
  await rebuildVectorIndex(url);
}
