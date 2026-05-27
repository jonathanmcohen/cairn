/**
 * v0.9.0 G8 P39 — SIEM forwarder tables.
 *
 * `siem_forwarders` holds per-workspace forwarder configs. `kind` is one of
 * `syslog | http | splunk_hec | datadog | s3` — this plan ships the first two
 * targets; P40 layers the rest onto the same scaffold. `credential_secret` is
 * an opaque string (bearer token for HTTP, HEC token for Splunk, etc.) and is
 * scrubbed from all log lines via the central REDACT_PATHS list.
 *
 * `siem_delivery_log` records every per-(forwarder, audit_event) attempt:
 * `success | retry | failed`. The dispatcher writes one row per attempt; the
 * retry cron sweep selects `status='retry' AND next_attempt_at <= now()` via
 * the partial index.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditLog } from './audit-log';
import { workspaces } from './workspaces';

export const siemForwarders = pgTable(
  'siem_forwarders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    endpoint: text('endpoint').notNull(),
    credentialSecret: text('credential_secret'),
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('siem_forwarders_workspace_idx').on(t.workspaceId),
    index('siem_forwarders_enabled_idx').on(t.workspaceId, t.enabled),
  ],
);

export const siemDeliveryLog = pgTable(
  'siem_delivery_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    forwarderId: uuid('forwarder_id')
      .notNull()
      .references(() => siemForwarders.id, { onDelete: 'cascade' }),
    auditEventId: uuid('audit_event_id')
      .notNull()
      .references(() => auditLog.id, { onDelete: 'cascade' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull(),
    attempt: integer('attempt').notNull().default(1),
    error: text('error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  },
  (t) => [index('siem_delivery_log_forwarder_idx').on(t.forwarderId)],
);

export type SiemForwarder = typeof siemForwarders.$inferSelect;
export type NewSiemForwarder = typeof siemForwarders.$inferInsert;
export type SiemDeliveryLogRow = typeof siemDeliveryLog.$inferSelect;
export type NewSiemDeliveryLogRow = typeof siemDeliveryLog.$inferInsert;
