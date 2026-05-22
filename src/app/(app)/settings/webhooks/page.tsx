import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import {
  type DeliveryRow,
  type WebhookRow,
  WebhooksManager,
} from '@/components/settings/webhooks-manager';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';

export default async function WebhooksSettingsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');
  // Webhook management is admin-only (workspace-admin-configured per the spec).
  if (!hasMinRole(ctx.role, 'admin')) redirect('/');

  // Never select `secret` — the plaintext is shown only once at creation.
  const hooks = await getDb()
    .select({
      id: schema.webhooks.id,
      url: schema.webhooks.url,
      events: schema.webhooks.events,
      active: schema.webhooks.active,
      createdAt: schema.webhooks.createdAt,
    })
    .from(schema.webhooks)
    .where(eq(schema.webhooks.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.webhooks.createdAt));

  // Recent deliveries across this workspace's hooks (joined so cross-workspace
  // rows never leak), newest first.
  const deliveries = await getDb()
    .select({
      id: schema.webhookDeliveries.id,
      webhookId: schema.webhookDeliveries.webhookId,
      event: schema.webhookDeliveries.event,
      status: schema.webhookDeliveries.status,
      lastStatus: schema.webhookDeliveries.lastStatus,
      attempts: schema.webhookDeliveries.attempts,
      createdAt: schema.webhookDeliveries.createdAt,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhooks, eq(schema.webhookDeliveries.webhookId, schema.webhooks.id))
    .where(eq(schema.webhooks.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(50);

  const initialHooks: WebhookRow[] = hooks.map((h) => ({
    id: h.id,
    url: h.url,
    events: h.events,
    active: h.active,
    createdAt: h.createdAt.toISOString(),
  }));

  const initialDeliveries: DeliveryRow[] = deliveries.map((d) => ({
    id: d.id,
    webhookId: d.webhookId,
    event: d.event,
    status: d.status,
    lastStatus: d.lastStatus,
    attempts: d.attempts,
    createdAt: d.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-3xl font-semibold">Webhooks</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Webhooks POST a JSON payload to your endpoint when subscribed events occur. Each request is
        signed with an <code>X-Cairn-Signature: sha256=…</code> header keyed by the hook&apos;s
        secret — verify it on your receiver. The secret is shown only once when created.
      </p>
      <WebhooksManager initialHooks={initialHooks} initialDeliveries={initialDeliveries} />
    </div>
  );
}
