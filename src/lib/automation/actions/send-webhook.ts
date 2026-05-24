import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { deliver } from '@/lib/webhooks/dispatch';
import { type ActionContext, BadConfigError } from './index';

/**
 * Send-webhook action. action_config = { webhookId: string }.
 * Inserts a pending delivery and schedules dispatch via setImmediate, mirroring
 * the v0.5 `emit` pattern. The synthetic event name is `automation.fired` so
 * downstream consumers can distinguish a rule-driven delivery from an event
 * pass-through.
 *
 * v0.7 ships shape #1 (existing webhookId) only — ad-hoc url/secret shape is
 * deferred to a later release.
 */
export async function runSendWebhook(
  config: Record<string, unknown>,
  payload: unknown,
  ctx: ActionContext,
): Promise<void> {
  const webhookId = typeof config.webhookId === 'string' ? config.webhookId : null;
  if (!webhookId) {
    throw new BadConfigError('send_webhook: action_config.webhookId is required');
  }

  const db = getDb();
  // Confirm the hook belongs to the rule's workspace (cross-workspace = not found).
  const [hook] = await db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!hook) {
    throw new Error(`webhook ${webhookId} not found in workspace ${ctx.workspaceId}`);
  }

  const [delivery] = await db
    .insert(schema.webhookDeliveries)
    .values({
      webhookId: hook.id,
      event: 'automation.fired',
      payload: { ruleId: ctx.ruleId, trigger: payload } as never,
      status: 'pending',
    })
    .returning({ id: schema.webhookDeliveries.id });
  if (!delivery) {
    throw new Error('failed to enqueue webhook delivery');
  }

  setImmediate(() => {
    void deliver(delivery.id).catch(() => {});
  });
}
