import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { enrichAuditEntries } from '@/lib/audit/enrich';
import { AuditFilterQuery, toAuditFilters } from '@/lib/audit/filters';
import { listAuditLog } from '@/lib/audit/query';
import { HttpError, requireRole } from '@/lib/auth/require-role';

// Filter params live in @/lib/audit/filters so the /export sibling (v0.10.0
// D2) accepts the exact same set; only the pagination params are local here.
const Query = AuditFilterQuery.extend({
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
      filters: toAuditFilters(parsed),
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    const enriched = await enrichAuditEntries(getDb(), result.entries);
    return NextResponse.json({ entries: enriched, nextCursor: result.nextCursor });
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
