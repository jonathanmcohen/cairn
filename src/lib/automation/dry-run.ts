import type { AutomationActionType, AutomationCondition } from '@/db/schema';
import { evaluateCondition } from '@/lib/automation/condition';

export type DryRunInput = {
  condition: AutomationCondition;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
};

export type DryRunResult = {
  matched: boolean;
  status: 'would_run' | 'condition_unmet' | 'invalid_config';
  actionSummary: string;
  error?: string;
};

function validateConfig(type: AutomationActionType, c: Record<string, unknown>): string | null {
  switch (type) {
    case 'notify':
      return typeof c.userId === 'string' && c.userId.length > 0 ? null : 'Notify needs a user.';
    case 'set_property':
      if (typeof c.databaseId !== 'string') return 'Set-property needs a database.';
      if (typeof c.propertyId !== 'string') return 'Set-property needs a property.';
      if (!('value' in c)) return 'Set-property needs a value.';
      return null;
    case 'create_page':
      return typeof c.templateId === 'string' ? null : 'Create-page needs a template.';
    case 'send_webhook':
      return typeof c.webhookId === 'string' ? null : 'Send-webhook needs a webhook.';
    default:
      return 'Unknown action type.';
  }
}

function summarize(type: AutomationActionType, c: Record<string, unknown>): string {
  switch (type) {
    case 'notify':
      return `notify user ${String(c.userId)}`;
    case 'set_property':
      return `set property ${String(c.propertyId)} = ${JSON.stringify(c.value)}`;
    case 'create_page':
      return `create page from template ${String(c.templateId)}`;
    case 'send_webhook':
      return `send webhook ${String(c.webhookId)}`;
    default:
      return type;
  }
}

/**
 * Evaluate a rule against a sample payload WITHOUT side effects: runs the same
 * condition logic the dispatcher uses, validates the action config, and reports
 * the would-be outcome. Never executes runAction; never writes automation_runs.
 */
export function dryRunRule(input: DryRunInput, payload: unknown): DryRunResult {
  const cfgErr = validateConfig(input.actionType, input.actionConfig);
  if (cfgErr) {
    return { matched: false, status: 'invalid_config', actionSummary: '', error: cfgErr };
  }
  const matched = evaluateCondition(input.condition, payload);
  return {
    matched,
    status: matched ? 'would_run' : 'condition_unmet',
    actionSummary: summarize(input.actionType, input.actionConfig),
  };
}
