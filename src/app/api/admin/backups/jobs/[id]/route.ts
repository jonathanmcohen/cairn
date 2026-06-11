/**
 * v0.10.0 C1 — backup job status poll (admin/owner only).
 *
 * GET answers `{ id, status, error? }` for a job started by
 * POST /api/admin/backups; 404 for an unknown id. The registry is per-process
 * (see src/lib/backups/jobs.ts) — in a multi-replica deployment only the
 * replica that started the job knows it.
 */

import { NextResponse } from 'next/server';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { getBackupJob } from '@/lib/backups/jobs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireRole('admin');
    const { id } = await ctx.params;
    const job = getBackupJob(id);
    if (!job) {
      return NextResponse.json({ error: 'unknown job id' }, { status: 404 });
    }
    return NextResponse.json({
      id: job.id,
      status: job.status,
      ...(job.error !== undefined ? { error: job.error } : {}),
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
