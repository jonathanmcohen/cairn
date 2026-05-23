import { setImmediate as setImmediateNode } from 'node:timers';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/:id/deliveries/:deliveryId/replay
 *
 * Re-enqueue an existing delivery row for the v0.5 P2 dispatcher to pick up.
 * Admin-gated. Cross-workspace (or mismatched webhook ↔ delivery) ids return
 * 404 to avoid leaking existence — same pattern as the listing routes.
 *
 * Wire shape: 202 on success, 404 if the (webhook, delivery) pair doesn't
 * exist or belongs to a different workspace, 403 if the caller isn't admin.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { id, deliveryId } = await params;
    const db = getDb();

    // Load the delivery JOINED to the webhook so the workspace scope check is
    // a single round trip and a cross-workspace id returns 404.
    const rows = await db
      .select({
        deliveryId: schema.webhookDeliveries.id,
        webhookId: schema.webhookDeliveries.webhookId,
        workspaceId: schema.webhooks.workspaceId,
      })
      .from(schema.webhookDeliveries)
      .innerJoin(schema.webhooks, eq(schema.webhookDeliveries.webhookId, schema.webhooks.id))
      .where(
        and(
          eq(schema.webhookDeliveries.id, deliveryId),
          eq(schema.webhookDeliveries.webhookId, id),
        ),
      )
      .limit(1);

    const hit = rows[0];
    if (!hit || hit.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Reset the row to `pending` + attempts=0 so the dispatcher's retry logic
    // treats it as a fresh attempt.
    await db
      .update(schema.webhookDeliveries)
      .set({ status: 'pending', attempts: 0, lastStatus: null, deliveredAt: null })
      .where(eq(schema.webhookDeliveries.id, deliveryId));

    // Fire-and-forget the actual HTTP attempt. Same pattern as the v0.5 P2
    // dispatcher's emit() — off the request path, never blocks the 202.
    setImmediateNode(() => {
      void (async () => {
        try {
          const { deliver } = await import('@/lib/webhooks/dispatch');
          await deliver(deliveryId);
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : err, deliveryId },
            '[webhooks] replay deliver failed',
          );
        }
      })();
    });

    return NextResponse.json({ status: 'enqueued', deliveryId }, { status: 202 });
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
