import { and, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { WebhookDeliveryRowActions } from '@/components/admin/webhook-delivery-row-actions';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { canonicalBody, type WebhookEvent } from '@/lib/webhooks/dispatch';
import { signBody } from '@/lib/webhooks/sign';

type Params = { id: string };

export const dynamic = 'force-dynamic';

/**
 * Admin-gated per-webhook delivery dashboard.
 *
 * Lists the most recent deliveries for one webhook (workspace-scoped). For
 * each row, the X-Cairn-Signature header is pre-computed server-side from the
 * stored secret + canonical payload, so the "Copy as curl" client action can
 * include a verbatim, working signature WITHOUT the secret ever leaving the
 * server.
 */
export default async function WebhookDeliveriesPage({ params }: { params: Promise<Params> }) {
  const ctx = await requireRole('admin');
  const { id } = await params;
  const db = getDb();

  // Workspace-scoped lookup; cross-workspace ids → 404 (existence-hiding).
  const owned = await db
    .select({
      id: schema.webhooks.id,
      url: schema.webhooks.url,
      events: schema.webhooks.events,
      secret: schema.webhooks.secret,
      active: schema.webhooks.active,
    })
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.workspaceId, ctx.workspaceId)))
    .limit(1);
  const hook = owned[0];
  if (!hook) notFound();

  const deliveries = await db
    .select({
      id: schema.webhookDeliveries.id,
      event: schema.webhookDeliveries.event,
      payload: schema.webhookDeliveries.payload,
      status: schema.webhookDeliveries.status,
      attempts: schema.webhookDeliveries.attempts,
      lastStatus: schema.webhookDeliveries.lastStatus,
      createdAt: schema.webhookDeliveries.createdAt,
      deliveredAt: schema.webhookDeliveries.deliveredAt,
    })
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.webhookId, id))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(100);

  // Pre-compute (canonicalBody, signature) per row so the client never sees
  // the secret. The canonicalBody helper is the same one the dispatcher uses,
  // so the signature is bit-identical to what receivers got.
  const signed = deliveries.map((d) => {
    const body = canonicalBody(d.event as WebhookEvent, d.payload);
    const signature = signBody(hook.secret, body);
    return { ...d, canonicalBody: body, signature };
  });

  return (
    <div>
      <nav className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
        {/* WCAG 2.5.5: each breadcrumb link gets a ≥44px touch target. */}
        <a
          className="inline-flex min-h-11 items-center px-1 hover:underline"
          href="/settings/admin"
        >
          ← Admin
        </a>
        <span aria-hidden="true">/</span>
        <a
          className="inline-flex min-h-11 items-center px-1 hover:underline"
          href="/settings/admin/webhooks"
        >
          Webhooks
        </a>
        <span aria-hidden="true">/</span>
        <span className="inline-flex min-h-11 items-center px-1">Deliveries</span>
      </nav>
      <h1 className="mb-1 text-2xl font-semibold">Deliveries</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        <code className="font-mono">{hook.url}</code> · events: {hook.events.join(', ')} · active:{' '}
        {hook.active ? 'yes' : 'no'}
      </p>

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Attempts</th>
              <th className="px-3 py-2 font-medium">HTTP</th>
              <th className="px-3 py-2 font-medium">Delivered</th>
              <th className="w-44 px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {signed.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={7}>
                  No deliveries yet.
                </td>
              </tr>
            ) : (
              signed.map((d) => (
                <tr key={d.id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {d.createdAt.toISOString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{d.event}</td>
                  <td className="px-3 py-2">{d.status}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.attempts}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.lastStatus ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {d.deliveredAt ? d.deliveredAt.toISOString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <WebhookDeliveryRowActions
                      deliveryId={d.id}
                      webhookId={hook.id}
                      webhookUrl={hook.url}
                      canonicalBody={d.canonicalBody}
                      signature={d.signature}
                      event={d.event}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
