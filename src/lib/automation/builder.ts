import type { AutomationActionType, AutomationCondition, AutomationOperator } from '@/db/schema';
import { type ConditionTree, MAX_CONDITION_TREE_DEPTH } from '@/lib/automation/condition-tree';
import { flatConditionToTree } from '@/lib/automation/condition-tree-backfill';
import { TRIGGER_EVENTS, type TriggerEvent } from '@/lib/automation/events';

/** One leaf condition row in the builder (carries a UI id). */
export type ConditionRow = {
  id: string;
  field: string;
  op: AutomationOperator;
  value: unknown;
};

/** A recursive logic group in the builder (carries a UI id). */
export type ConditionGroupModel = {
  id: string;
  logic: 'and' | 'or';
  children: Array<ConditionRow | ConditionGroupModel>;
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
  conditions: ConditionGroupModel;
  actions: ActionCard[];
};

/** Compiled action with its execution order. */
export type CompiledAction = {
  type: AutomationActionType;
  config: Record<string, unknown>;
  sortOrder: number;
};

/** The body the API persists: singular back-compat fields + tree + ordered actions. */
export type CompiledRuleBody = {
  name: string;
  triggerEvent: TriggerEvent;
  condition: AutomationCondition;
  conditionTree: ConditionTree;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
  actions: CompiledAction[];
};

export type CompileResult = { ok: true; body: CompiledRuleBody } | { ok: false; error: string };

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`;
}

function isGroupModel(n: ConditionRow | ConditionGroupModel): n is ConditionGroupModel {
  return 'logic' in n && Array.isArray((n as ConditionGroupModel).children);
}

/** A fresh canvas: chosen trigger, empty AND group, one (incomplete) notify action. */
export function emptyBuilder(triggerEvent: TriggerEvent): BuilderModel {
  return {
    triggerEvent,
    conditions: { id: newId(), logic: 'and', children: [] },
    actions: [{ id: newId(), type: 'notify', config: {} }],
  };
}

/** Strip UI ids → the persisted ConditionTree; throws past the depth cap (caller catches). */
function toTree(group: ConditionGroupModel, depth = 0): ConditionTree {
  if (depth > MAX_CONDITION_TREE_DEPTH) {
    throw new Error(`condition group is nested too deep (max ${MAX_CONDITION_TREE_DEPTH})`);
  }
  return {
    logic: group.logic,
    children: group.children.map((c) =>
      isGroupModel(c) ? toTree(c, depth + 1) : { field: c.field, op: c.op, value: c.value },
    ),
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

/** First leaf of the tree, for the singular back-compat `condition` field. */
function firstLeaf(group: ConditionGroupModel): ConditionRow | null {
  for (const c of group.children) {
    if (isGroupModel(c)) {
      const nested = firstLeaf(c);
      if (nested) return nested;
    } else {
      return c;
    }
  }
  return null;
}

/**
 * Compile the visual builder model into the persisted body. v0.9.8 lifts the v0.7
 * single-condition/single-action limit: emits a nested `conditionTree` + an ordered
 * `actions` array. The singular `condition`/`actionType`/`actionConfig` fields are
 * still populated (first leaf / first action) for the legacy dispatcher fallback
 * and the existing API/list code.
 */
export function compileBuilder(name: string, model: BuilderModel): CompileResult {
  if (name.trim().length === 0) return { ok: false, error: 'Rule needs a name.' };
  if (!(TRIGGER_EVENTS as readonly string[]).includes(model.triggerEvent))
    return { ok: false, error: 'Unknown trigger event.' };

  let conditionTree: ConditionTree;
  try {
    conditionTree = toTree(model.conditions);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid condition.' };
  }

  if (model.actions.length === 0) return { ok: false, error: 'Rule needs an action.' };
  const actions: CompiledAction[] = [];
  for (const [i, card] of model.actions.entries()) {
    const actionErr = validateAction(card);
    if (actionErr) return { ok: false, error: actionErr };
    actions.push({ type: card.type, config: card.config, sortOrder: i });
  }

  const leaf = firstLeaf(model.conditions);
  const condition: AutomationCondition = leaf
    ? { property: leaf.field, operator: leaf.op, value: leaf.value }
    : {};
  const first = actions[0];
  if (!first) return { ok: false, error: 'Rule needs an action.' };

  return {
    ok: true,
    body: {
      name: name.trim(),
      triggerEvent: model.triggerEvent,
      condition,
      conditionTree,
      actionType: first.type,
      actionConfig: first.config,
      actions,
    },
  };
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

function asTrigger(v: string): TriggerEvent {
  return (TRIGGER_EVENTS as readonly string[]).includes(v) ? (v as TriggerEvent) : 'row.created';
}

/** Shape persisted in automation_rules — singular fields plus the optional editor blob. */
export type PersistedRule = {
  triggerEvent: TriggerEvent | string;
  condition: AutomationCondition;
  actionType: AutomationActionType | string;
  actionConfig: Record<string, unknown>;
  builder: BuilderModel | null;
};

/** Reattach UI ids to a stored builder group recursively. */
function rehydrateGroup(group: ConditionGroupModel): ConditionGroupModel {
  return {
    id: group.id ?? newId(),
    logic: group.logic === 'or' ? 'or' : 'and',
    children: group.children.map((c) =>
      isGroupModel(c)
        ? rehydrateGroup(c)
        : { id: c.id ?? newId(), field: c.field, op: c.op, value: c.value },
    ),
  };
}

/** Rebuild the editor model. Prefers the stored builder blob; else reverses the singular fields. */
export function decompileRule(rule: PersistedRule): BuilderModel {
  if (rule.builder) {
    return {
      triggerEvent: asTrigger(rule.builder.triggerEvent),
      conditions: rehydrateGroup(rule.builder.conditions),
      actions: rule.builder.actions.map((a) => ({
        id: a.id ?? newId(),
        type: asActionType(a.type),
        config: { ...a.config },
      })),
    };
  }
  const tree = flatConditionToTree(rule.condition);
  return {
    triggerEvent: asTrigger(rule.triggerEvent),
    conditions: {
      id: newId(),
      logic: tree.logic,
      children: tree.children.map((c) =>
        'logic' in c
          ? { id: newId(), logic: c.logic, children: [] }
          : { id: newId(), field: c.field, op: c.op, value: c.value },
      ),
    },
    actions: [
      { id: newId(), type: asActionType(rule.actionType), config: { ...rule.actionConfig } },
    ],
  };
}
