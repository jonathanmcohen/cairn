import type { AutomationActionType, AutomationCondition, AutomationOperator } from '@/db/schema';
import { TRIGGER_EVENTS, type TriggerEvent } from '@/lib/automation/dispatcher';

/** One condition row in the visual builder (mirrors the dispatcher's singular condition fields). */
export type ConditionRow = {
  id: string;
  property: string;
  operator: AutomationOperator;
  value: unknown;
};

/** A group of condition rows joined by a single combinator. v1 supports one row max (see compileBuilder). */
export type ConditionGroup = {
  combinator: 'and' | 'or';
  rows: ConditionRow[];
};

/** One action card. `config` is the type-specific action_config the runner consumes. */
export type ActionCard = {
  id: string;
  type: AutomationActionType;
  config: Record<string, unknown>;
};

/** Full editor state for one rule's canvas. Persisted verbatim in automation_rules.builder. */
export type BuilderModel = {
  triggerEvent: TriggerEvent;
  conditions: ConditionGroup;
  actions: ActionCard[];
};

/** The singular body the existing /api/automation/rules endpoint + dispatcher consume. */
export type CompiledRuleBody = {
  name: string;
  triggerEvent: TriggerEvent;
  condition: AutomationCondition;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
};

export type CompileResult = { ok: true; body: CompiledRuleBody } | { ok: false; error: string };

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`;
}

/** A fresh canvas: chosen trigger, no condition filter, one (incomplete) notify action. */
export function emptyBuilder(triggerEvent: TriggerEvent): BuilderModel {
  return {
    triggerEvent,
    conditions: { combinator: 'and', rows: [] },
    actions: [{ id: newId(), type: 'notify', config: {} }],
  };
}

/** Validate one action card's config against its runner contract. Returns an error string or null. */
function validateAction(card: ActionCard): string | null {
  const c = card.config;
  switch (card.type) {
    case 'notify':
      return typeof c.userId === 'string' && c.userId.length > 0
        ? null
        : 'Notify action needs a user to notify.';
    case 'set_property':
      if (typeof c.databaseId !== 'string' || c.databaseId.length === 0)
        return 'Set-property action needs a database.';
      if (typeof c.propertyId !== 'string' || c.propertyId.length === 0)
        return 'Set-property action needs a property.';
      if (!('value' in c)) return 'Set-property action needs a value.';
      return null;
    case 'create_page':
      return typeof c.templateId === 'string' && c.templateId.length > 0
        ? null
        : 'Create-page action needs a template.';
    case 'send_webhook':
      return typeof c.webhookId === 'string' && c.webhookId.length > 0
        ? null
        : 'Send-webhook action needs a webhook.';
    default:
      return 'Unknown action type.';
  }
}

/**
 * Compile the visual builder model into the singular {condition, actionType, actionConfig}
 * body the dispatcher already consumes. v1 supports exactly one condition row and one action;
 * richer AND/OR + chaining is persisted as editor state (automation_rules.builder) but rejected
 * here until the dispatcher learns to read it (see plan Non-Goals).
 */
export function compileBuilder(name: string, model: BuilderModel): CompileResult {
  if (name.trim().length === 0) return { ok: false, error: 'Rule needs a name.' };
  if (!(TRIGGER_EVENTS as readonly string[]).includes(model.triggerEvent))
    return { ok: false, error: 'Unknown trigger event.' };

  const rows = model.conditions.rows;
  if (rows.length > 1)
    return {
      ok: false,
      error:
        'Only one condition is supported for now (multi-condition AND/OR is coming in a later release).',
    };

  let condition: AutomationCondition = {};
  if (rows.length === 1) {
    const r = rows[0];
    if (!r) return { ok: false, error: 'Empty condition row.' };
    if (r.property.trim().length === 0) return { ok: false, error: 'Condition needs a property.' };
    condition = { property: r.property, operator: r.operator, value: r.value };
  }

  if (model.actions.length === 0) return { ok: false, error: 'Rule needs an action.' };
  if (model.actions.length > 1)
    return {
      ok: false,
      error: 'Only one action is supported for now (action chaining is coming in a later release).',
    };
  const action = model.actions[0];
  if (!action) return { ok: false, error: 'Rule needs an action.' };
  const actionErr = validateAction(action);
  if (actionErr) return { ok: false, error: actionErr };

  return {
    ok: true,
    body: {
      name: name.trim(),
      triggerEvent: model.triggerEvent,
      condition,
      actionType: action.type,
      actionConfig: action.config,
    },
  };
}

/** Shape persisted in automation_rules — singular fields plus the optional editor blob. */
export type PersistedRule = {
  triggerEvent: TriggerEvent | string;
  condition: AutomationCondition;
  actionType: AutomationActionType | string;
  actionConfig: Record<string, unknown>;
  builder: BuilderModel | null;
};

function asTrigger(v: string): TriggerEvent {
  return (TRIGGER_EVENTS as readonly string[]).includes(v) ? (v as TriggerEvent) : 'row.created';
}

const ACTION_TYPES: readonly AutomationActionType[] = [
  'notify',
  'send_webhook',
  'set_property',
  'create_page',
];

function asActionType(v: string): AutomationActionType {
  return (ACTION_TYPES as readonly string[]).includes(v) ? (v as AutomationActionType) : 'notify';
}

/** Rebuild the editor model from a saved rule. Prefers the stored builder blob; else reverses the singular fields. */
export function decompileRule(rule: PersistedRule): BuilderModel {
  if (rule.builder) {
    return {
      triggerEvent: asTrigger(rule.builder.triggerEvent),
      conditions: {
        combinator: rule.builder.conditions.combinator === 'or' ? 'or' : 'and',
        rows: rule.builder.conditions.rows.map((r) => ({ ...r })),
      },
      actions: rule.builder.actions.map((a) => ({
        id: a.id,
        type: asActionType(a.type),
        config: { ...a.config },
      })),
    };
  }
  const rows: ConditionRow[] =
    'operator' in rule.condition
      ? [
          {
            id: newId(),
            property: rule.condition.property,
            operator: rule.condition.operator,
            value: rule.condition.value,
          },
        ]
      : [];
  return {
    triggerEvent: asTrigger(rule.triggerEvent),
    conditions: { combinator: 'and', rows },
    actions: [
      { id: newId(), type: asActionType(rule.actionType), config: { ...rule.actionConfig } },
    ],
  };
}
