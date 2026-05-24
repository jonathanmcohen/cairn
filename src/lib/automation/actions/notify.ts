import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { type ActionContext, BadConfigError } from './index';

/**
 * Notify action. action_config = { userId: string, message?: string }.
 * Inserts a row into `notifications` with type='automation' and a payload
 * that includes the configured message + the trigger payload (for audit).
 *
 * Cairn's existing notifications/create.ts exports typed wrappers
 * (notifyMentions, notifyCommentReply) — neither matches an automation-fired
 * notification cleanly, and the notification table accepts free-text `type`.
 * We insert directly with type='automation'.
 */
export async function runNotify(
  config: Record<string, unknown>,
  payload: unknown,
  ctx: ActionContext,
): Promise<void> {
  const targetUserId = typeof config.userId === 'string' ? config.userId : null;
  if (!targetUserId) {
    throw new BadConfigError('notify: action_config.userId is required');
  }
  const message = typeof config.message === 'string' ? config.message : undefined;

  // The schema's typed `NotificationPayload` is a discriminated union of the
  // built-in shapes; the automation payload is intentionally distinct, so we
  // cast via `unknown` to satisfy the jsonb column's `$type`.
  const automationPayload = {
    ruleId: ctx.ruleId,
    message,
    trigger: payload,
  } as unknown as schema.NotificationPayload;

  await getDb().insert(schema.notifications).values({
    userId: targetUserId,
    workspaceId: ctx.workspaceId,
    type: 'automation',
    payload: automationPayload,
  });
}
