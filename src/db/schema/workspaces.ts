import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('homelab'),
  publicSiteSlug: text('public_site_slug').unique(),
  publicSiteEnabled: boolean('public_site_enabled').notNull().default(false),
  requireTwofa: boolean('require_2fa').notNull().default(false),
  // Circular FK with pages.workspace_id — declared without `.references(...)`;
  // the FK constraint is hand-appended in the generated migration SQL.
  homePageId: uuid('home_page_id'),
  // v0.8.0 G3 P8 — quick-capture inbox pointer. Lazily populated on first
  // capture (see src/lib/inbox/lazy-page.ts); ON DELETE SET NULL so deleting
  // the inbox page just clears the pointer, next capture re-creates it. Same
  // circular-FK situation as homePageId — FK constraint added by hand in the
  // generated migration SQL.
  inboxPageId: uuid('inbox_page_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
