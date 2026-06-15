/**
 * Opt-in singleton scheduler for cron_schedules rows. Polls every pollMs
 * (default 60s), executes due/enabled rows by spawning `node dist/server/cli.js ...`,
 * writes last_run_at + last_status + last_error + advances next_run_at via cron-parser.
 *
 * MULTI-INSTANCE SAFE (v0.10.3 CFG-3): every tick first takes a Postgres
 * SESSION-scoped advisory lock (`pg_try_advisory_lock`) on a fixed key. Only
 * the instance that wins the lock runs the poll-and-dispatch for that tick;
 * other instances see the lock held and skip the tick (the work is being done
 * elsewhere). The module-scoped re-entry guard below is still kept so a slow
 * batch within ONE process never overlaps its own next tick.
 *
 * The lock is held on a dedicated single-connection postgres-js client (max:1)
 * because advisory locks are session-scoped — try-lock and unlock must run on
 * the same physical connection. The pooled application `db` is used for the
 * actual row reads/writes. If no lock connection can be opened (no
 * DATABASE_URL), the scheduler degrades to the legacy single-instance behavior
 * (re-entry guard only) rather than refusing to run.
 *
 * Operators should still prefer running the scheduler on ONE instance; the
 * advisory lock makes >1 instance SAFE (no double-fire), not load-balanced.
 * See docs/operations.md ("Cron-driven CLI scheduler").
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { and, eq, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type SchedulerHandle = { stop: () => Promise<void> };

/**
 * Fixed application-defined advisory-lock key for "a Cairn scheduler tick is in
 * flight". Arbitrary but STABLE — distinct from the migrations lock
 * (4021966011) and the backup lock (746450424143) so the three never collide.
 */
export const SCHEDULER_ADVISORY_LOCK_KEY = 4021966012;

export type StartSchedulerOpts = {
  db: Db;
  /** Poll interval in ms. Defaults to 60_000. */
  pollMs?: number;
  /** Override the path to the compiled CLI bundle (tests pin this). */
  cliPath?: string;
  /**
   * Connection string for the dedicated single-connection advisory-lock client.
   * Defaults to `process.env.DATABASE_URL`. Pass an explicit value in tests
   * (and to prove two concurrent ticks don't double-process).
   */
  lockConnectionString?: string;
  /** Override the advisory-lock key (tests use a private key to avoid cross-test contention). */
  lockKey?: number;
};

export function startScheduler(opts: StartSchedulerOpts): SchedulerHandle {
  const pollMs = opts.pollMs ?? 60_000;
  const cliPath = opts.cliPath ?? path.resolve(process.cwd(), 'dist/server/cli.js');
  const lockKey = opts.lockKey ?? SCHEDULER_ADVISORY_LOCK_KEY;
  const connectionString = opts.lockConnectionString ?? process.env.DATABASE_URL;
  let stopped = false;
  // Module-scoped re-entry guard: a slow batch must not overlap with the next tick.
  let running = false;

  // Dedicated single-connection client for the session-scoped advisory lock.
  // When no connection string is available we leave it null and run the legacy
  // single-instance path (re-entry guard only).
  const lockSql = connectionString ? postgres(connectionString, { max: 1 }) : null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      // Single-runner election: only the instance that wins the advisory lock
      // processes this tick. Others skip — another instance holds it.
      // `acquired` tracks whether we actually hold the lock (so finally unlocks
      // exactly what we took). A lock-connection FAILURE fails OPEN: we run the
      // tick without the lock (legacy single-instance behavior) rather than
      // silently refusing to run — a briefly-unreachable lock DB must never
      // wedge the scheduler. Only a successfully-acquired-by-someone-else lock
      // makes us skip.
      let acquired = false;
      if (lockSql) {
        let lockUsable = true;
        try {
          const [lock] = await lockSql<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_lock(${lockKey}) AS locked`;
          acquired = lock?.locked === true;
        } catch (err) {
          console.warn('[scheduler] advisory-lock acquire failed; running without lock:', err);
          lockUsable = false; // fail open
        }
        if (lockUsable && !acquired) return; // another instance is running this tick
      }

      try {
        let dueRows: schema.CronSchedule[];
        try {
          dueRows = await opts.db
            .select()
            .from(schema.cronSchedules)
            .where(
              and(
                eq(schema.cronSchedules.enabled, true),
                lte(schema.cronSchedules.nextRunAt, new Date()),
              ),
            );
        } catch (err) {
          console.warn('[scheduler] read failed:', err);
          return;
        }
        for (const row of dueRows) {
          if (stopped) return;
          await runOne(opts.db, row, cliPath);
        }
      } finally {
        if (lockSql && acquired) {
          // Session-scoped: also auto-released if the process dies, so a crashed
          // tick can never wedge future ticks.
          await lockSql`SELECT pg_advisory_unlock(${lockKey})`.catch(() => {});
        }
      }
    } finally {
      running = false;
    }
  };

  // Fire once immediately on start, then on the interval. Matches the v0.6 P21
  // backup-interval behavior (operators expect the first tick now, not after pollMs).
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, pollMs);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      if (lockSql) await lockSql.end({ timeout: 5 }).catch(() => {});
    },
  };
}

async function runOne(db: Db, row: schema.CronSchedule, cliPath: string): Promise<void> {
  const argv = row.command.trim().split(/\s+/);
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn('node', [cliPath, ...argv], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });

  // Advance next_run_at via cron-parser.
  let nextRun: Date;
  try {
    const interval = CronExpressionParser.parse(row.cronSpec, { currentDate: new Date() });
    nextRun = interval.next().toDate();
  } catch (err) {
    // Malformed cron_spec — disable the row to prevent a poison loop.
    await db
      .update(schema.cronSchedules)
      .set({
        enabled: false,
        lastStatus: 'failure',
        lastError: `cron_spec parse error: ${String(err)}`,
        lastRunAt: new Date(),
      })
      .where(eq(schema.cronSchedules.id, row.id));
    return;
  }

  await db
    .update(schema.cronSchedules)
    .set({
      lastRunAt: new Date(),
      lastStatus: exitCode === 0 ? 'success' : 'failure',
      lastError: exitCode === 0 ? null : `exit code ${exitCode}`,
      nextRunAt: nextRun,
    })
    .where(eq(schema.cronSchedules.id, row.id));
}
