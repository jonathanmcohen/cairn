import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

export const pageAclInvites = pgTable(
  'page_acl_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    // 'view' | 'comment' | 'edit' | 'owner' — CHECK in migration 0062.
    permission: text('permission').notNull(),
    token: text('token').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    tokenUnique: uniqueIndex('page_acl_invites_token_unique').on(t.token),
    pageIdx: index('page_acl_invites_page_idx').on(t.pageId),
  }),
);

export type PageAclInvite = typeof pageAclInvites.$inferSelect;
export type NewPageAclInvite = typeof pageAclInvites.$inferInsert;
