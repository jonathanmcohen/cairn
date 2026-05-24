import type * as schema from '@/db/schema';

/** Caller-supplied context — populated by the dispatcher from the rule row. */
export type ActionContext = {
  ruleId: string;
  workspaceId: string;
  /** The user who created the rule. May be null if the user was deleted. */
  createdBy: string | null;
};

/** Thrown by a runner when its `action_config` is malformed. */
export class BadConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BadConfigError';
  }
}

/**
 * Dispatch on `action_type` to the matching runner. Re-thrown errors land in
 * `automation_runs.error` (per P16's failure path).
 *
 * Held on a `runner` object so dispatcher tests can `vi.spyOn(actions, 'runAction')`
 * — the spy targets the named export, and the dispatcher invokes it through
 * the module namespace so the spy is honored.
 */
export async function runAction(
  type: schema.AutomationActionType,
  config: Record<string, unknown>,
  payload: unknown,
  ctx: ActionContext,
): Promise<void> {
  switch (type) {
    case 'notify': {
      const { runNotify } = await import('./notify');
      return runNotify(config, payload, ctx);
    }
    case 'send_webhook': {
      const { runSendWebhook } = await import('./send-webhook');
      return runSendWebhook(config, payload, ctx);
    }
    case 'set_property': {
      const { runSetProperty } = await import('./set-property');
      return runSetProperty(config, payload, ctx);
    }
    case 'create_page': {
      const { runCreatePage } = await import('./create-page');
      return runCreatePage(config, payload, ctx);
    }
    default: {
      throw new BadConfigError(`unknown action_type: ${type as string}`);
    }
  }
}

/**
 * Tiny mustache-lite substitution. Replaces `{{a.b.c}}` with the dotted-path
 * lookup on `payload`, or the empty string if the path doesn't resolve.
 * Exported for reuse by create_page + unit-tested directly.
 */
export function applyTemplate(template: string, payload: unknown): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const v = path.split('.').reduce<unknown>((acc, key) => {
      if (acc == null || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[key];
    }, payload);
    if (v == null) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
}
