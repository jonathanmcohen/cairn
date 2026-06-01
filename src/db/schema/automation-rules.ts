import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { BuilderModel } from '@/lib/automation/builder';
import { users } from './users';
import { workspaces } from './workspaces';

/** Condition shape stored in the `condition` jsonb. Empty object = match-all. */
export type AutomationCondition =
  | Record<string, never>
  | {
      property: string;
      operator: AutomationOperator;
      value: unknown;
    };

export type AutomationOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'lt'
  | 'between'
  | 'is_empty'
  | 'is_not_empty'
  | 'is_true'
  | 'is_false';

export type AutomationActionType = 'notify' | 'send_webhook' | 'set_property' | 'create_page';

/** A single leaf in the condition tree (mirrors src/lib/automation/condition-tree.ts). */
export type ConditionTreeLeaf = {
  field: string;
  op: AutomationOperator;
  value: unknown;
};

/** A logic group joining children with AND/OR; children may be groups (nested). */
export type ConditionTreeGroup = {
  logic: 'and' | 'or';
  children: Array<ConditionTreeLeaf | ConditionTreeGroup>;
};

export const automationRules = pgTable(
  'automation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Closed enum at the lib layer — see TRIGGER_EVENTS in src/lib/automation/dispatcher.ts.
    // e.g. 'row.created' | 'row.updated' | 'row.deleted' | 'page.created' | ...
    triggerEvent: text('trigger_event').notNull(),
    // {property: string, operator: string, value: unknown} — see src/lib/automation/condition.ts.
    // Empty object means "always match".
    condition: jsonb('condition').$type<AutomationCondition>().notNull().default({}),
    // Nested AND/OR tree (v0.9.8). When non-null the dispatcher evaluates this
    // instead of the singular `condition`. Backfilled in migration 0058 as one
    // implicit {logic:'and', children:[...]} group from the flat condition.
    conditionTree: jsonb('condition_tree').$type<ConditionTreeGroup | null>(),
    // 'notify' | 'send_webhook' | 'set_property' | 'create_page' — runner registry in P17.
    actionType: text('action_type').notNull(),
    // Action-type-specific config; shape validated by the runner.
    actionConfig: jsonb('action_config').$type<Record<string, unknown>>().notNull(),
    // Visual-builder editor state — round-trips the canvas. The dispatcher ignores
    // this column and reads the singular condition/actionType/actionConfig fields.
    builder: jsonb('builder').$type<BuilderModel | null>(),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspaceTrigger: index('automation_rules_workspace_trigger_idx').on(
      t.workspaceId,
      t.triggerEvent,
    ),
  }),
);

export type AutomationRule = typeof automationRules.$inferSelect;
export type NewAutomationRule = typeof automationRules.$inferInsert;
