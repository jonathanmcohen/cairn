/**
 * v0.9.0 G8 P40 — Daily S3 NDJSON archive cron driver.
 *
 * Once a day (01:15 UTC per `registerSiemDailyArchiveCron`) the scheduler
 * spawns `cli siem:daily-archive`, which calls `runDailyS3Archives(now)`. For
 * every enabled `kind='s3'` forwarder across every workspace this function
 * archives YESTERDAY's audit rows via `archiveDayToS3` and persists one
 * `siem_delivery_log` row per non-empty archive (success or failed).
 *
 * Empty days produce no upload and no log row — P39's
 * `siem_delivery_log.audit_event_id` is `NOT NULL` and we'd have no event id
 * to point at. Operators see "no audit rows" implicitly by the absence of a
 * delivery log entry; the daily cron itself is recorded against the global
 * `cron_schedules.last_run_at` so a silent failure of the cron is still
 * visible.
 *
 * The archive runs OUTSIDE `dispatchAuditEvent` (per-event fan-out) because
 * the natural cadence is a batch sweep, not per-event. A misconfigured S3
 * bucket therefore can't stall the per-event hot path — failures stay
 * visible in `siem_delivery_log` and the operator can re-trigger the CLI
 * manually after fixing credentials.
 */

import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { logger } from '@/lib/observability/logger';
import { archiveDayToS3 } from './targets/s3-archive';

type Db = PostgresJsDatabase<typeof schema>;

export type RunDailyArchivesOptions = {
  /** Test seam — inject a stub db handle. Production uses the singleton. */
  db?: Db;
  /** Test seam — inject a stub archive fn (skips the real S3 client). */
  archive?: typeof archiveDayToS3;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yesterday(now: Date): Date {
  // The cron tick fires at 01:15 UTC `now`; "yesterday" = `now - 1 day`,
  // truncated to the UTC day in `archiveDayToS3` itself.
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * Per-tick sweep: iterates every enabled s3 forwarder, archives yesterday's
 * audit rows for its workspace, and writes one delivery-log row per
 * non-empty archive. Returns the swept count for visibility in cron logs.
 */
export async function runDailyS3Archives(
  now: Date,
  opts: RunDailyArchivesOptions = {},
): Promise<{ swept: number; succeeded: number; failed: number }> {
  const db = opts.db ?? getDb();
  const archive = opts.archive ?? archiveDayToS3;
  const target = yesterday(now);
  const dayStart = new Date(`${ymd(target)}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const forwarders = await db
    .select()
    .from(schema.siemForwarders)
    .where(and(eq(schema.siemForwarders.kind, 's3'), eq(schema.siemForwarders.enabled, true)));

  let swept = 0;
  let succeeded = 0;
  let failed = 0;
  for (const f of forwarders) {
    swept += 1;
    // `audit_event_id` is NOT NULL — pin the delivery-log row to the
    // earliest event of the archived day. If the day is empty we skip the
    // log row entirely (no upload, no row).
    const [firstEvent] = await db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.workspaceId, f.workspaceId),
          gte(schema.auditLog.createdAt, dayStart),
          lt(schema.auditLog.createdAt, dayEnd),
        ),
      )
      .orderBy(asc(schema.auditLog.createdAt))
      .limit(1);

    try {
      const result = await archive({
        workspaceId: f.workspaceId,
        forwarderId: f.id,
        date: target,
        db,
      });
      if (result.rowCount === 0 || !firstEvent) {
        // Empty day — no upload, no log row. The cron's `last_run_at` still
        // ticks via the scheduler, so an operator can confirm the sweep ran.
        continue;
      }
      await db.insert(schema.siemDeliveryLog).values({
        forwarderId: f.id,
        auditEventId: firstEvent.id,
        status: 'success',
        attempt: 1,
      });
      succeeded += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed += 1;
      logger.error(
        { forwarderId: f.id, workspaceId: f.workspaceId, err: msg },
        'siem.archive_failed',
      );
      if (firstEvent) {
        await db.insert(schema.siemDeliveryLog).values({
          forwarderId: f.id,
          auditEventId: firstEvent.id,
          status: 'failed',
          attempt: 1,
          error: msg,
        });
      }
    }
  }
  return { swept, succeeded, failed };
}
