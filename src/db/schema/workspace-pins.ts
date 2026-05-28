import { index, integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * v0.9.0 G2 P12 — Workspace-pinned pages.
 *
 * Admins curate a workspace-wide "Pinned" section that renders at the top
 * of the sidebar for every member (above per-user Favorites + Spaces).
 * Composite PK on (workspace_id, page_id) makes re-pinning a no-op via
 * `.onConflictDoNothing()` and lets `requirePageAccess`-style cross-workspace
 * checks rely on simple existence queries.
 *
 * NOT to be confused with `favorites` (v0.8 P17) — those are per-user pins.
 */
export const workspacePins = pgTable(
  'workspace_pins',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    pinnedBy: uuid('pinned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.pageId] }),
    posIdx: index('workspace_pins_workspace_position_idx').on(t.workspaceId, t.position),
  }),
);

export type WorkspacePin = typeof workspacePins.$inferSelect;
export type NewWorkspacePin = typeof workspacePins.$inferInsert;
