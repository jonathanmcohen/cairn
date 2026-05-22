import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    // Verify the hook belongs to the active workspace before exposing its log.
    const owned = await getDb()
      .select({ id: schema.webhooks.id })
      .from(schema.webhooks)
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (owned.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const deliveries = await getDb()
      .select({
        id: schema.webhookDeliveries.id,
        event: schema.webhookDeliveries.event,
        status: schema.webhookDeliveries.status,
        lastStatus: schema.webhookDeliveries.lastStatus,
        attempts: schema.webhookDeliveries.attempts,
        createdAt: schema.webhookDeliveries.createdAt,
        deliveredAt: schema.webhookDeliveries.deliveredAt,
      })
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, id))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(50);
    return NextResponse.json({ deliveries });
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
