/**
 * v0.10.0 C3 — scheduled-backup management (admin/owner only).
 *
 * GET returns `{schedule, schedulerEnabled, runs}`:
 *   - `schedule` — THE global backup row in `cron_schedules` (or null),
 *     including the stored `command` string so clients (and the e2e suite)
 *     can verify it carries `--out`;
 *   - `schedulerEnabled` — whether CAIRN_SCHEDULER_ENABLED=1 on this process
 *     (read from process.env exactly like the scheduler boot in
 *     src/instrumentation-node.ts; the flag is not part of env.ts). Without
 *     it a schedule row never fires — the UI shows a prominent warning;
 *   - `runs` — the 20 newest durable `backup_runs` rows.
 *
 * PUT upserts the single schedule from STRUCTURED fields only. The command
 * string is built server-side (src/lib/backups/schedule.ts) so `--out
 * <CAIRN_BACKUP_DIR>` is always present — the v0.7 audit trap was a
 * hand-authored row without --out that threw on every cron tick. The cron
 * spec is validated with cron-parser (the exact parser the scheduler runs).
 *
 * DELETE removes the schedule row.
 *
 * Backups are INSTANCE-level, so the gate is the caller's role in their
 * active workspace — same as the sibling /api/admin/backups routes.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import type { CronSchedule } from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import {
  deleteBackupSchedule,
  getBackupSchedule,
  isValidCronSpec,
  listRecentBackupRuns,
  upsertBackupSchedule,
} from '@/lib/backups/schedule';
import { env } from '@/lib/env';

const Body = z.object({
  enabled: z.boolean(),
  cronSpec: z.string().min(1).max(100),
  target: z.enum(['local', 's3']),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  keep: z.number().int().min(1).max(1000).optional(),
});

function serializeSchedule(row: CronSchedule | null) {
  if (!row) return null;
  return {
    id: row.id,
    command: row.command,
    cronSpec: row.cronSpec,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
  };
}

function schedulerEnabled(): boolean {
  // Same read as the scheduler boot gate in src/instrumentation-node.ts —
  // the flag is intentionally NOT in env.ts.
  return process.env.CAIRN_SCHEDULER_ENABLED === '1';
}

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    const db = getDb();
    const [schedule, runs] = await Promise.all([
      getBackupSchedule(db),
      listRecentBackupRuns(db, 20),
    ]);
    return NextResponse.json({
      schedule: serializeSchedule(schedule),
      schedulerEnabled: schedulerEnabled(),
      runs,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    await requireRole('admin');
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    if (!isValidCronSpec(parsed.data.cronSpec)) {
      return NextResponse.json({ error: 'invalid-cron-spec' }, { status: 400 });
    }
    const row = await upsertBackupSchedule(getDb(), {
      outDir: env().CAIRN_BACKUP_DIR,
      enabled: parsed.data.enabled,
      cronSpec: parsed.data.cronSpec,
      target: parsed.data.target,
      retentionDays: parsed.data.retentionDays,
      keep: parsed.data.keep,
    });
    return NextResponse.json({
      schedule: serializeSchedule(row),
      schedulerEnabled: schedulerEnabled(),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function DELETE(): Promise<Response> {
  try {
    await requireRole('admin');
    const deleted = await deleteBackupSchedule(getDb());
    return NextResponse.json({ deleted });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
