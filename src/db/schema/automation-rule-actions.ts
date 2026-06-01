import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { automationRules } from './automation-rules';

/**
 * Ordered actions for a rule (v0.9.8 drag-reorder). Each row is one action card;
 * `sortOrder` is the execution order the dispatcher honors. Existing single-action
 * rules keep using automation_rules.actionType/actionConfig — this table is the
 * multi-action path, backfilled from the legacy singular action at index 0.
 */
export const automationRuleActions = pgTable(
  'automation_rule_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => automationRules.id, { onDelete: 'cascade' }),
    actionType: text('action_type').notNull(),
    actionConfig: jsonb('action_config').$type<Record<string, unknown>>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    byRuleOrder: index('automation_rule_actions_rule_order_idx').on(t.ruleId, t.sortOrder),
  }),
);

export type AutomationRuleAction = typeof automationRuleActions.$inferSelect;
export type NewAutomationRuleAction = typeof automationRuleActions.$inferInsert;
