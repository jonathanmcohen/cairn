import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { automationRules } from './automation-rules';

export const automationRuns = pgTable('automation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: uuid('rule_id')
    .notNull()
    .references(() => automationRules.id, { onDelete: 'cascade' }),
  triggerPayload: jsonb('trigger_payload').$type<Record<string, unknown>>().notNull(),
  // 'success' | 'failed' | 'condition_unmet'
  status: text('status').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AutomationRun = typeof automationRuns.$inferSelect;
export type NewAutomationRun = typeof automationRuns.$inferInsert;
export type AutomationRunStatus = 'success' | 'failed' | 'condition_unmet';
