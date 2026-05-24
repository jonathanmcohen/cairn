import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const cronSchedules = pgTable(
  'cron_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable: a global schedule (e.g. nightly full backup) has no workspace.
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // The CLI command-line, e.g. 'backup --target s3 --retention-days 14'.
    // The scheduler.ts splits this on whitespace and execs node dist/server/cli.js.
    command: text('command').notNull(),
    // Standard 5-field cron syntax — cron-parser handles it.
    cronSpec: text('cron_spec').notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status'), // 'success' | 'failure'
    lastError: text('last_error'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Hot path: SELECT WHERE enabled AND next_run_at <= now()
    byEnabledNextRun: index('cron_schedules_enabled_next_run_idx').on(t.enabled, t.nextRunAt),
  }),
);

export type CronSchedule = typeof cronSchedules.$inferSelect;
export type NewCronSchedule = typeof cronSchedules.$inferInsert;
