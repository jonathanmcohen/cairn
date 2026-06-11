import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  __resetRebuildJobForTests,
  getRebuildJob,
  HNSW_INDEX_NAME,
  type RebuildJob,
  rebuildVectorIndex,
  startRebuildJob,
} from '@/lib/search/rebuild-index';
import type { ReindexSummary } from '@/lib/search/reindex-cli';
import { startPostgres, stopPostgres } from '../../helpers/db';

// v0.10.0 D8 — pgvector index rebuild: the REINDEX CONCURRENTLY pass against
// the REAL HNSW index, and the globalThis-backed job registry (debounce, the
// errors-don't-abort contract, and the error path) with stubbed passes.

let uri: string;
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(() => {
  __resetRebuildJobForTests();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const EMPTY_SUMMARY: ReindexSummary = { processed: 0, embedded: 0, skipped: 0, errors: 0 };

async function waitForSettled(timeoutMs = 10_000): Promise<RebuildJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getRebuildJob();
    if (job && job.state !== 'running') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('rebuild job never settled');
}

describe('rebuildVectorIndex', () => {
  it('REINDEXes the real HNSW index (the non-transactional footgun assert)', async () => {
    // Sanity: the migration-created index is present in the harness DB —
    // otherwise this test would "pass" by reindexing nothing.
    const rows = (await sql`
      select indexname from pg_indexes
      where schemaname = 'public' and indexname = ${HNSW_INDEX_NAME}
    `) as unknown as { indexname: string }[];
    expect(rows).toHaveLength(1);

    // Must resolve. If the implementation ever wrapped the REINDEX in a
    // transaction (sql.begin), Postgres would reject it with error 25001
    // "REINDEX CONCURRENTLY cannot run inside a transaction block" and this
    // await would throw.
    await expect(rebuildVectorIndex(uri)).resolves.toBeUndefined();
  });

  it('rejects with the Postgres error when the index does not exist', async () => {
    await sql.unsafe(`ALTER INDEX ${HNSW_INDEX_NAME} RENAME TO d8_tmp_renamed_idx`);
    try {
      await expect(rebuildVectorIndex(uri)).rejects.toThrow(/does not exist/);
    } finally {
      await sql.unsafe(`ALTER INDEX d8_tmp_renamed_idx RENAME TO ${HNSW_INDEX_NAME}`);
    }
  });
});

describe('startRebuildJob registry', () => {
  it('starts a job, then debounces a second call while running (same job, started:false)', async () => {
    const vectors = deferred<ReindexSummary>();
    const first = startRebuildJob({
      connectionString: uri,
      db,
      runVectors: () => vectors.promise,
      runIndex: async () => {},
    });
    expect(first.started).toBe(true);
    expect(first.job.state).toBe('running');
    expect(first.job.phase).toBe('vectors');
    expect(getRebuildJob()?.id).toBe(first.job.id);

    const second = startRebuildJob({
      connectionString: uri,
      db,
      runVectors: async () => EMPTY_SUMMARY,
      runIndex: async () => {},
    });
    expect(second.started).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    vectors.resolve(EMPTY_SUMMARY);
    const settled = await waitForSettled();
    expect(settled.id).toBe(first.job.id);
    expect(settled.state).toBe('done');
    expect(settled.finishedAt).not.toBeNull();
  });

  it('proceeds to the index pass and ends done even when the vectors pass reports errors', async () => {
    const summaryWithErrors: ReindexSummary = { processed: 5, embedded: 2, skipped: 0, errors: 3 };
    let indexRan = false;
    const { started } = startRebuildJob({
      connectionString: uri,
      db,
      runVectors: async () => summaryWithErrors,
      runIndex: async () => {
        indexRan = true;
      },
    });
    expect(started).toBe(true);

    const settled = await waitForSettled();
    expect(indexRan).toBe(true);
    expect(settled.state).toBe('done');
    expect(settled.vectors).toEqual(summaryWithErrors);
    expect(settled.error).toBeNull();
    expect(settled.finishedAt).not.toBeNull();
  });

  it('a thrown index pass flips the job to error with the message and finishedAt set', async () => {
    startRebuildJob({
      connectionString: uri,
      db,
      runVectors: async () => EMPTY_SUMMARY,
      runIndex: async () => {
        throw new Error('REINDEX exploded');
      },
    });

    const settled = await waitForSettled();
    expect(settled.state).toBe('error');
    expect(settled.error).toBe('REINDEX exploded');
    expect(settled.phase).toBe('index');
    expect(settled.vectors).toEqual(EMPTY_SUMMARY);
    expect(settled.finishedAt).not.toBeNull();
  });

  it('a thrown vectors pass also flips the job to error (phase names the failing pass)', async () => {
    startRebuildJob({
      connectionString: uri,
      db,
      runVectors: async () => {
        throw new Error('embedding infrastructure down');
      },
      runIndex: async () => {
        throw new Error('must not reach the index pass');
      },
    });

    const settled = await waitForSettled();
    expect(settled.state).toBe('error');
    expect(settled.error).toBe('embedding infrastructure down');
    expect(settled.phase).toBe('vectors');
    expect(settled.finishedAt).not.toBeNull();
  });

  it('a settled job no longer debounces — the next start creates a fresh job', async () => {
    startRebuildJob({
      connectionString: uri,
      db,
      runVectors: async () => EMPTY_SUMMARY,
      runIndex: async () => {},
    });
    const firstSettled = await waitForSettled();

    const next = startRebuildJob({
      connectionString: uri,
      db,
      runVectors: async () => EMPTY_SUMMARY,
      runIndex: async () => {},
    });
    expect(next.started).toBe(true);
    expect(next.job.id).not.toBe(firstSettled.id);
    await waitForSettled();
  });

  it('getRebuildJob returns null when nothing has ever run', () => {
    expect(getRebuildJob()).toBeNull();
  });
});
