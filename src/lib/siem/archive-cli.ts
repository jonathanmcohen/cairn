/**
 * v0.9.0 G8 P40 — `siem:daily-archive` CLI entrypoint.
 *
 * Spawned daily by the scheduler. Module-level `isRunning` guards against an
 * overlap; the scheduler retries on failure so a duplicate spawn would race.
 * Returns the swept summary so the caller's stdout includes a one-line audit
 * trail (the scheduler captures stdout into `cron_schedules.last_status`).
 */

import { runDailyS3Archives } from './archive';

let isRunning = false;

export async function runSiemDailyArchive(): Promise<{
  swept: number;
  succeeded: number;
  failed: number;
}> {
  if (isRunning) return { swept: 0, succeeded: 0, failed: 0 };
  isRunning = true;
  try {
    return await runDailyS3Archives(new Date());
  } finally {
    isRunning = false;
  }
}
