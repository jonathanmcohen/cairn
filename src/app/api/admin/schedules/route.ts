import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { listSchedules } from '@/lib/scheduler/manage';

/**
 * v0.10.3 CFG-3 — admin Schedules console list endpoint.
 *
 * Returns every `cron_schedules` row (global + per-workspace). Admin-gated.
 */
export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    return NextResponse.json({ schedules: await listSchedules(getDb()) });
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
