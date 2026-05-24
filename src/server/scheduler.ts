/**
 * Opt-in singleton scheduler for cron_schedules rows. Polls every pollMs
 * (default 60s), executes due/enabled rows by spawning `node dist/server/cli.js ...`,
 * writes last_run_at + last_status + last_error + advances next_run_at via cron-parser.
 *
 * SINGLE-INSTANCE only — two app processes both poll and double-fire.
 * Operators with multi-instance deployments should disable this scheduler
 * and run an external cron / CronJob (documented in docs/operations.md).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { and, eq, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type SchedulerHandle = { stop: () => Promise<void> };

export type StartSchedulerOpts = {
  db: Db;
  /** Poll interval in ms. Defaults to 60_000. */
  pollMs?: number;
  /** Override the path to the compiled CLI bundle (tests pin this). */
  cliPath?: string;
};

export function startScheduler(opts: StartSchedulerOpts): SchedulerHandle {
  const pollMs = opts.pollMs ?? 60_000;
  const cliPath = opts.cliPath ?? path.resolve(process.cwd(), 'dist/server/cli.js');
  let stopped = false;
  // Module-scoped re-entry guard: a slow batch must not overlap with the next tick.
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
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
