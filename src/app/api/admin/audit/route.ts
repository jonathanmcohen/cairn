import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { AUDIT_ACTIONS } from '@/lib/audit/actions';
import { listAuditLog } from '@/lib/audit/query';
import { HttpError, requireRole } from '@/lib/auth/require-role';

const Query = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorId: z.uuid().optional(),
  targetType: z.string().optional(),
  targetId: z.uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(req.url);
    const parsed = Query.parse(Object.fromEntries(url.searchParams));
    const result = await listAuditLog(getDb(), {
      workspaceId: ctx.workspaceId,
      filters: {
        action: parsed.action,
        actorId: parsed.actorId,
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        from: parsed.from ? new Date(parsed.from) : undefined,
        to: parsed.to ? new Date(parsed.to) : undefined,
      },
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
