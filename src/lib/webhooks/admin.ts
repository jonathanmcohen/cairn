import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

type Db = PostgresJsDatabase<typeof schema>;

export type WebhookListRow = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: Date;
};

export type CreateWebhookInput = {
  workspaceId: string;
  actorUserId: string;
  url: string;
  events: string[];
};

export type CreatedWebhook = {
  webhook: WebhookListRow;
  /** Plaintext secret — surfaced ONCE here, never re-rendered, never persisted in the audit log. */
  secret: string;
};

/**
 * Create a workspace webhook with a fresh signing secret. The insert + the
 * `webhook.created` audit row are written in a single transaction so the
 * audit can never drift from the action (spec §2.27). Audit metadata records
 * only `{url, events}` — the secret is deliberately NEVER recorded.
 *
 * The caller is responsible for `assertPublicUrl` on `input.url` (the route
 * layer keeps the SSRF guard close to the request so its 400 errors map
 * cleanly to validation failures).
 */
export async function createWebhook(db: Db, input: CreateWebhookInput): Promise<CreatedWebhook> {
  const secret = `cairn_whsec_${randomBytes(24).toString('hex')}`;
  return db.transaction(async (tx) => {
    const [hook] = await tx
      .insert(schema.webhooks)
      .values({
        workspaceId: input.workspaceId,
        url: input.url,
        events: input.events,
        secret,
      })
      .returning({
        id: schema.webhooks.id,
        url: schema.webhooks.url,
        events: schema.webhooks.events,
        active: schema.webhooks.active,
        createdAt: schema.webhooks.createdAt,
      });
    if (!hook) throw new Error('failed to create webhook');
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'webhook.created',
      targetType: 'webhook',
      targetId: hook.id,
      metadata: { url: input.url, events: input.events },
    });
    return { webhook: hook, secret };
  });
}

export type DeleteWebhookErrorCode = 'NOT_FOUND';

export class DeleteWebhookError extends Error {
  constructor(
    public code: DeleteWebhookErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DeleteWebhookError';
  }
}

/**
 * Delete a webhook scoped to a workspace. The delete + the
 * `webhook.deleted` audit row are written in a single transaction.
 * Cross-workspace ids throw `NOT_FOUND` so we don't leak existence.
 */
export async function deleteWebhook(
  db: Db,
  input: { workspaceId: string; webhookId: string; actorUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.id, input.webhookId),
          eq(schema.webhooks.workspaceId, input.workspaceId),
        ),
      )
      .returning({ id: schema.webhooks.id });
    if (deleted.length === 0) throw new DeleteWebhookError('NOT_FOUND');
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'webhook.deleted',
      targetType: 'webhook',
      targetId: input.webhookId,
      metadata: { webhookId: input.webhookId },
    });
  });
}
