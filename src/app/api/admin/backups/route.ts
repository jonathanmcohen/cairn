/**
 * v0.10.0 C1 — instance-level backup snapshot API (admin/owner only).
 *
 * GET returns the bundle list from CAIRN_BACKUP_DIR (bare array, newest
 * first). Backups are INSTANCE-level (the CLI dumps the whole database), so
 * the gate is the caller's role in their active workspace — viewers/editors
 * get 403 like every other /api/admin surface.
 *
 * POST starts a backup job (`node dist/server/cli.js backup --out <dir>`) and
 * answers 202 with the job id to poll at /api/admin/backups/jobs/[id]. When
 * the pg_dump client binary is missing on the server it answers 503 with a
 * friendly error instead of spawning a doomed job.
 */

import { NextResponse } from 'next/server';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { startBackupJob } from '@/lib/backups/jobs';
import { listBackupBundles } from '@/lib/backups/list';
import { env } from '@/lib/env';

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    const bundles = await listBackupBundles(env().CAIRN_BACKUP_DIR);
    return NextResponse.json(bundles);
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

export async function POST(): Promise<Response> {
  try {
    await requireRole('admin');
    const result = startBackupJob({ dir: env().CAIRN_BACKUP_DIR });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'pg_dump was not found on the server PATH; install the postgresql client tools' },
        { status: 503 },
      );
    }
    return NextResponse.json({ jobId: result.job.id }, { status: 202 });
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
