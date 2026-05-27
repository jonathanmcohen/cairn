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
import { workspaces } from './workspaces';

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  events: text('events').array().notNull(),
  secret: text('secret').notNull(),
  active: boolean('active').notNull().default(true),
  // v0.9.0 G7 P36 — chat-bridge discriminator. `generic` keeps the canonical
  // signed-body POST path (v0.5 P2 behaviour, default for every existing row).
  // `slack`/`discord` swap the body for a translated platform-specific payload
  // in `src/lib/webhooks/dispatch.ts` before POSTing. A CHECK constraint
  // appended to the migration restricts the column to those three values.
  kind: text('kind').notNull().default('generic'),
  // Per-platform metadata: Slack stores {team_id, channel_id, signing_secret};
  // Discord stores {application_id, channel_id, public_key, bot_token}. The
  // server treats this jsonb as opaque; operators paste values through the
  // admin UI. Never log it — secret-like fields live here.
  platformMetadata: jsonb('platform_metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull(), // pending|success|failed
    attempts: integer('attempts').notNull().default(0),
    lastStatus: integer('last_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => ({
    byWebhookIdx: index('webhook_deliveries_webhook_id_created_at_idx').on(
      t.webhookId,
      t.createdAt,
    ),
  }),
);

export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
