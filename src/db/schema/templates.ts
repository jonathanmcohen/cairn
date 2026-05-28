import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * v0.9.0 G4 P24/P25 — `visibility` column added by migration 0048 (atomic with
 * P24's `page_approvals`). Three tiers: `private` (creator only), `workspace`
 * (any member), `public` (gallery / global). Default `workspace` mirrors the
 * de-facto sharing tier of every existing row at migration time.
 */
export const TEMPLATE_VISIBILITIES = ['private', 'workspace', 'public'] as const;
export type TemplateVisibility = (typeof TEMPLATE_VISIBILITIES)[number];

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }), // null = built-in/global
    name: text('name').notNull(),
    kind: text('kind').notNull(), // page|database
    payload: jsonb('payload').notNull(),
    builtIn: boolean('built_in').notNull().default(false),
    // v0.9.0 G4 P24/P25 — sharing tier (see TEMPLATE_VISIBILITIES). Backed by a
    // CHECK constraint declared in migration 0048.
    visibility: text('visibility').notNull().default('workspace').$type<TemplateVisibility>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspaceKindIdx: index('templates_workspace_id_kind_idx').on(t.workspaceId, t.kind),
  }),
);

export type Template = typeof templates.$inferSelect;
