/**
 * v0.9.0 G4 P24 — `page_approvals` table.
 *
 * Tamper-evident decision log for page approval workflow. Each row pins the
 * decision to a specific `page_versions` snapshot so post-decision edits don't
 * silently invalidate the approval — the UI can clearly say "approved at
 * version X" when the page has since advanced.
 *
 * `signature_hmac` is computed by the library layer (see
 * `src/lib/pages/approval-signature.ts`) over the canonical
 * `pageId|versionSnapshotId|approverUserId|decision|approvedAtISO` string
 * under `AUTH_SECRET`. The DB only stores the hex; verification is server-side
 * on read.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pageVersions } from './page-versions';
import { pages } from './pages';
import { users } from './users';

export const APPROVAL_DECISIONS = ['approved', 'rejected', 'requested_changes'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const pageApprovals = pgTable(
  'page_approvals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    versionSnapshotId: uuid('version_snapshot_id')
      .notNull()
      .references(() => pageVersions.id, { onDelete: 'restrict' }),
    approverUserId: uuid('approver_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decision: text('decision').notNull().$type<ApprovalDecision>(),
    comment: text('comment'),
    signatureHmac: text('signature_hmac').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pageIdx: index('page_approvals_page_idx').on(t.pageId, t.approvedAt.desc()),
    approverIdx: index('page_approvals_approver_idx').on(t.approverUserId),
  }),
);

export type PageApproval = typeof pageApprovals.$inferSelect;
export type NewPageApproval = typeof pageApprovals.$inferInsert;
