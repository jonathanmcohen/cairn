import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_ADVISORY_LOCK_KEY,
  BACKUP_LOCK_HELD_ERROR,
  runBackupWithHistory,
} from '@/lib/backups/run-history';
import { startPostgres, stopPostgres } from '../helpers/db';

// v0.10.0 C3 — durable backup_runs history + advisory-lock single-flight.
//
// This exercises the EXACT code path the CLI backup dispatch runs
// (src/server/cli.ts wraps backup() in runBackupWithHistory) against a real
// migrated Postgres — including migration 0071 applying cleanly — without
// needing pg_dump on PATH (the cli-backup round-trip suite in
// src/server/__tests__/cli-backup.test.ts skips on machines whose pg_dump
// major mismatches; this suite only needs Docker).

let url: string;
let sql: ReturnType<typeof postgres>;

type RunRow = {
  status: string;
  trigger: string;
  bundle_ts: string | null;
  error: string | null;
  duration_ms: number | null;
  started_at: Date;
  finished_at: Date | null;
};

async function allRuns(): Promise<RunRow[]> {
  return (await sql`
    SELECT status, trigger, bundle_ts, error, duration_ms, started_at, finished_at
    FROM backup_runs ORDER BY started_at ASC
  `) as unknown as RunRow[];
}

beforeAll(async () => {
  url = await startPostgres();
  sql = postgres(url);
}, 180_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await stopPostgres();
});

beforeEach(async () => {
  await sql`DELETE FROM backup_runs`;
});

describe('runBackupWithHistory', () => {
  it('records a done row with bundle_ts and a duration, and releases the lock', async () => {
    const outcome = await runBackupWithHistory({
      databaseUrl: url,
      trigger: 'manual',
      doBackup: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return 'ts-0001';
      },
    });
    expect(outcome.kind).toBe('done');

    const rows = await allRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'done', trigger: 'manual', bundle_ts: 'ts-0001' });
    expect(rows[0]?.duration_ms).toBeGreaterThan(0);
    expect(rows[0]?.finished_at).not.toBeNull();

    // Lock released: a fresh session can take it immediately.
    const probe = postgres(url, { max: 1 });
    try {
      const [lock] = await probe<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_lock(${BACKUP_ADVISORY_LOCK_KEY}) AS locked`;
      expect(lock?.locked).toBe(true);
      await probe`SELECT pg_advisory_unlock(${BACKUP_ADVISORY_LOCK_KEY})`;
    } finally {
      await probe.end({ timeout: 5 });
    }
  });

  it('records a failed row and rethrows when the dump throws (lock still released)', async () => {
    await expect(
      runBackupWithHistory({
        databaseUrl: url,
        trigger: 'scheduled',
        doBackup: async () => {
          throw new Error('pg_dump exited with code 1');
        },
      }),
    ).rejects.toThrow('pg_dump exited with code 1');

    const rows = await allRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'failed',
      trigger: 'scheduled',
      error: 'pg_dump exited with code 1',
      bundle_ts: null,
    });

    // A follow-up run must not be blocked by a stale lock.
    const second = await runBackupWithHistory({
      databaseUrl: url,
      trigger: 'manual',
      doBackup: async () => 'ts-0002',
    });
    expect(second.kind).toBe('done');
  });

  it('two concurrent runs: exactly one dumps, the other writes a failed lock row and skips', async () => {
    let dumps = 0;
    const run = () =>
      runBackupWithHistory({
        databaseUrl: url,
        trigger: 'manual',
        doBackup: async () => {
          dumps += 1;
          // Hold the lock long enough that the second run definitely overlaps.
          await new Promise((resolve) => setTimeout(resolve, 400));
          return 'ts-contended';
        },
      });

    const [first, second] = await Promise.all([
      run(),
      // Slight stagger so the loser arrives while the winner is mid-dump
      // (a perfectly simultaneous start could still race the try-lock, which
      // is fine — one of them wins either way).
      new Promise((resolve) => setTimeout(resolve, 100)).then(run),
    ]);

    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(['done', 'locked']);
    expect(dumps).toBe(1);

    const rows = await allRuns();
    expect(rows).toHaveLength(2);
    const failed = rows.find((r) => r.status === 'failed');
    const done = rows.find((r) => r.status === 'done');
    expect(failed?.error).toBe(BACKUP_LOCK_HELD_ERROR);
    expect(done?.bundle_ts).toBe('ts-contended');
  }, 20_000);
});
