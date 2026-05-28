import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * v0.9.0 G2 P11 — Workspace-scoped grouping of pages with optional per-space
 * ACLs. A page either has `space_id = NULL` (the sidebar's "Unfiled" bucket)
 * or belongs to exactly one space inside its workspace.
 *
 * `parent_space_id` is reserved for future nested spaces; the FK is appended
 * by hand in 0040_spaces.sql because Drizzle cannot emit self-FKs in the
 * callback form.
 */
export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    icon: text('icon'),
    // Self-FK declared in SQL (Drizzle gotcha). Type only here.
    parentSpaceId: uuid('parent_space_id'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUq: uniqueIndex('spaces_slug_per_workspace_uq').on(t.workspaceId, t.slug),
    workspaceIdx: index('spaces_workspace_id_idx').on(t.workspaceId),
    parentIdx: index('spaces_parent_space_id_idx').on(t.parentSpaceId),
  }),
);

export type Space = typeof spaces.$inferSelect;
export type NewSpace = typeof spaces.$inferInsert;

/**
 * Per-space role row. Absence of any row for a (space, user) pair means the
 * space role chain falls back to the workspace role only. Required role
 * column is a free-form text column (not pgEnum) so it can coexist with the
 * existing workspace `member_role` enum without conflict; the CHECK clause
 * enforces the allowed vocabulary.
 */
export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.spaceId, t.userId] }),
    roleCheck: check(
      'space_members_role_chk',
      sql`${t.role} IN ('owner', 'admin', 'editor', 'viewer')`,
    ),
    userIdx: index('space_members_user_id_idx').on(t.userId),
  }),
);

export type SpaceMember = typeof spaceMembers.$inferSelect;
export type NewSpaceMember = typeof spaceMembers.$inferInsert;
export type SpaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
