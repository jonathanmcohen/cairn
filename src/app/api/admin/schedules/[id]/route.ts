import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { InvalidCronError, updateSchedule } from '@/lib/scheduler/manage';

const PatchBody = z
  .object({
    cronSpec: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => b.cronSpec !== undefined || b.enabled !== undefined, {
    message: 'nothing to update',
  });

/**
 * v0.10.3 CFG-3 — edit a cron schedule's cron expression and/or enabled flag.
 *
 * Admin-gated. Invalid cron → 400 (no write). Audits `config.schedule_updated`
 * against the row uuid. Unknown id → 404.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const body = PatchBody.parse(await req.json());

    const row = await updateSchedule(getDb(), id, body);
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

    await recordAudit(getDb(), {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'config.schedule_updated',
      targetType: 'cron_schedule',
      targetId: row.id,
      metadata: { command: row.command, cronSpec: row.cronSpec, enabled: row.enabled },
    });

    return NextResponse.json({ schedule: row });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof InvalidCronError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    {
      status: 500,
    },
  );
}
