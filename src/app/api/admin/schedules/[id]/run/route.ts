import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { runScheduleNow } from '@/lib/scheduler/manage';

/**
 * v0.10.3 CFG-3 — "Run now": mark a schedule due immediately. The in-process
 * poller (≤60s cadence) then runs it under the single-runner advisory lock —
 * we never spawn the CLI from the request path, which preserves the
 * single-runner semantics. "Run now" means "due immediately", not "executed
 * synchronously". Admin-gated. Audits `config.schedule_run`. Unknown id → 404.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;

    const row = await runScheduleNow(getDb(), id);
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

    await recordAudit(getDb(), {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'config.schedule_run',
      targetType: 'cron_schedule',
      targetId: row.id,
      metadata: { command: row.command },
    });

    return NextResponse.json({ schedule: row });
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
