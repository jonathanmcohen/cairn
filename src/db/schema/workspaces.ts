import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // v0.9.4 UX audit #81 — optional workspace icon, prefix-encoded like
  // pages.icon ("emoji::🪨" / "file::<uuid>"). text NULL; no FK.
  icon: text('icon'),
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
  // v0.9.0 G1 P7 — workspace-wide E2E encryption mode discriminator.
  // 'off' | 'per_page' | 'workspace_wide'; no DB-level CHECK — API rejects
  // unknown values. Set to 'workspace_wide' by /api/workspaces/[id]/e2e/enable.
  e2eMode: text('e2e_mode').notNull().default('off'),
  // v0.9.0 G2 P13 — trash retention. The daily cron purges trashed pages
  // older than this many days. 0 = never auto-purge (manual only).
  // CAIRN_TRASH_RETENTION_DAYS env stays the GLOBAL default for fresh
  // workspaces; once set per-workspace, this column wins.
  trashRetentionDays: integer('trash_retention_days').notNull().default(30),
  // v0.9.0 G2 P13 — forward-declared for P26 (page lifecycle). Default for
  // newly-created pages when the editor does not pass an explicit status.
  // v0.9.9 K2 #216 — flipped to 'draft' (security-adjacent: new pages must not
  // be auto-published before review). Migration 0066 changes the column
  // default; existing workspaces keep whatever default an admin already chose.
  defaultPageStatus: text('default_page_status').notNull().default('draft'),
  // v0.9.0 G2 P13 — forward-declared for P30 (federated search). When true,
  // this workspace participates in peer-instance search routing.
  enableFederatedSearch: boolean('enable_federated_search').notNull().default(false),
  // v0.10.0 F1 — workspace brand. Both nullable; NULL = default look.
  // brand_logo_file_id → files(id) ON DELETE SET NULL. Declared WITHOUT
  // `.references(...)` because files.workspace_id already references
  // workspaces.id — the same circular-FK situation as homePageId/inboxPageId;
  // the FK constraint lives in migration 0074's hand-written SQL.
  brandLogoFileId: uuid('brand_logo_file_id'),
  // Normalized '#rrggbb' hex written by setWorkspaceBrand; readers clamp for
  // WCAG contrast at render time (src/lib/workspaces/brand-color.ts).
  brandPrimaryColor: text('brand_primary_color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
