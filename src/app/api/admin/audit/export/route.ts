import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { auditCsvHeader, auditCsvRows } from '@/lib/audit/csv';
import { enrichAuditEntries } from '@/lib/audit/enrich';
import { AuditFilterQuery, toAuditFilters } from '@/lib/audit/filters';
import { listAuditLog } from '@/lib/audit/query';
import { HttpError, requireRole } from '@/lib/auth/require-role';

/**
 * GET /api/admin/audit/export — stream the FULL filtered audit log as CSV
 * (v0.10.0 D2). Admin-gated like the sibling list route and accepts the same
 * filter params (action, actorId, targetType, targetId, from, to) but NO
 * cursor/limit: while the viewer pages at 100 rows, the export walks every
 * matching row through the same keyset query lib in batches and writes them
 * into a ReadableStream so memory stays flat regardless of result size.
 *
 * Response: `text/csv; charset=utf-8` +
 * `Content-Disposition: attachment; filename="cairn-audit-<date>.csv"`.
 */

// listAuditLog clamps `limit` at its MAX_LIMIT (100), so this is the
// effective page size of the streaming walk.
const BATCH_SIZE = 100;

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(req.url);
    const parsed = AuditFilterQuery.parse(Object.fromEntries(url.searchParams));
    const filters = toAuditFilters(parsed);
    const db = getDb();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(auditCsvHeader()));
          let cursor: string | undefined;
          do {
            const result = await listAuditLog(db, {
              workspaceId: ctx.workspaceId,
              filters,
              limit: BATCH_SIZE,
              cursor,
            });
            if (result.entries.length > 0) {
              const enriched = await enrichAuditEntries(db, result.entries);
              controller.enqueue(encoder.encode(auditCsvRows(enriched)));
            }
            cursor = result.nextCursor ?? undefined;
          } while (cursor);
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="cairn-audit-${date}.csv"`,
      },
    });
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
