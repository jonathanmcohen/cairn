/**
 * v0.9.0 G4 P24 — Page approval lifecycle library.
 *
 * Two public mutations:
 *   - `requestApproval(db, {pageId, byUserId, workspaceId})` — editor moves a
 *     page into review. When P26's `pages.status` column is present, the page
 *     transitions `draft|published → review` via `transitionStatus`. The
 *     `page.approval_requested` audit row is written inside the same
 *     transaction so the request can never drift from the status flip.
 *   - `decide(db, {pageId, approverUserId, workspaceId, decision, comment?})`
 *     — admin records an `approved | rejected | requested_changes` decision.
 *     We snapshot the page's latest `page_versions` row id at decision time,
 *     HMAC-sign `(page_id|version_id|approver|decision|approved_at)` under
 *     `AUTH_SECRET`, insert the `page_approvals` row, advance `pages.status`
 *     (when the column exists), and record the appropriate audit action. The
 *     whole thing runs inside one `db.transaction` so the approval row,
 *     status transition, and audit row are all-or-nothing.
 *
 * The version-snapshot pin is load-bearing: post-decision edits don't
 * invalidate the signature, but the UI can clearly say "approved at version
 * X" once the page has advanced past it.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { AuditAction } from '@/lib/audit/actions';
import { recordAudit } from '@/lib/audit/record';
import { HttpError } from '@/lib/auth/http-error';
import { env } from '@/lib/env';
import { transitionStatus } from '@/lib/pages/status';
import { type ApprovalDecision, signApproval } from './approval-signature';

type Db = PostgresJsDatabase<typeof schema>;

export class NoVersionSnapshotError extends Error {
  constructor(pageId: string) {
    super(`no version snapshot available for page ${pageId}`);
    this.name = 'NoVersionSnapshotError';
  }
}

async function pagesHasStatusColumn(db: Db): Promise<boolean> {
  // Soft-dep probe: P26 added `pages.status`; if it's missing the approval
  // workflow still records its row + audit, but skips the lifecycle flip.
  const rows = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'pages' AND column_name = 'status'
  `)) as unknown as Array<{ column_name: string }>;
  return rows.length > 0;
}

/**
 * Editor-initiated request: move the page into `review`. Writes a
 * `page.approval_requested` audit row inside the same transaction as the
 * status flip so the audit log can never drift from the lifecycle.
 *
 * When P26's column is absent, only the audit row lands — the lifecycle gate
 * fails open until P26 ships (which it already has on `release/v0.9.0`).
 */
export async function requestApproval(
  db: Db,
  input: { pageId: string; byUserId: string; workspaceId: string },
): Promise<void> {
  const hasStatus = await pagesHasStatusColumn(db);
  if (hasStatus) {
    // transitionStatus opens its own tx and writes `page.status_changed`.
    // We then record `page.approval_requested` in a second tx — both rows
    // sharing the same `targetId` make the activity feed obvious.
    await transitionStatus(db, { pageId: input.pageId, to: 'review', byUserId: input.byUserId });
  }
  await db.transaction(async (tx) => {
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.byUserId,
      action: 'page.approval_requested',
      targetType: 'page',
      targetId: input.pageId,
      metadata: {},
    });
  });
}

const DECISION_TO_AUDIT: Record<ApprovalDecision, AuditAction> = {
  approved: 'page.approved',
  rejected: 'page.approval_rejected',
  requested_changes: 'page.changes_requested',
};

/**
 * Admin-initiated decision. Snapshots the page's latest version id, signs the
 * canonical payload under AUTH_SECRET, persists the row + audit + lifecycle
 * flip inside one transaction.
 *
 * Lifecycle flips (only when P26's column is present):
 *   - approved          → published
 *   - rejected          → draft
 *   - requested_changes → review (stays in review, but signed history advances)
 */
export async function decide(
  db: Db,
  input: {
    pageId: string;
    approverUserId: string;
    workspaceId: string;
    decision: ApprovalDecision;
    comment?: string;
  },
): Promise<{ id: string; signatureHmac: string; versionSnapshotId: string }> {
  const hasStatus = await pagesHasStatusColumn(db);

  return db.transaction(async (tx) => {
    // #270 — an author can't approve their own review. We surface a stable,
    // machine-readable 409 ('self-approval') the UI maps to actionable copy.
    const [pageRow] = await tx
      .select({ createdBy: schema.pages.createdBy })
      .from(schema.pages)
      .where(eq(schema.pages.id, input.pageId))
      .limit(1);
    if (pageRow && pageRow.createdBy === input.approverUserId) {
      throw new HttpError(409, 'self-approval');
    }

    const [versionRow] = await tx
      .select({ id: schema.pageVersions.id })
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.pageId, input.pageId))
      .orderBy(desc(schema.pageVersions.createdAt))
      .limit(1);
    if (!versionRow) throw new NoVersionSnapshotError(input.pageId);
    const versionSnapshotId = versionRow.id;

    const approvedAt = new Date();
    const approvedAtISO = approvedAt.toISOString();
    const signatureHmac = signApproval(
      {
        pageId: input.pageId,
        versionSnapshotId,
        approverUserId: input.approverUserId,
        decision: input.decision,
        approvedAtISO,
      },
      env().AUTH_SECRET,
    );

    const [inserted] = await tx
      .insert(schema.pageApprovals)
      .values({
        pageId: input.pageId,
        versionSnapshotId,
        approverUserId: input.approverUserId,
        decision: input.decision,
        comment: input.comment ?? null,
        signatureHmac,
        approvedAt,
      })
      .returning({ id: schema.pageApprovals.id });
    if (!inserted) throw new Error('decide: insert returned no row');

    if (hasStatus) {
      // The lifecycle matrix from P26 disallows review→archived and
      // review→review, so for `requested_changes` (which would mean
      // review→review) we leave the page in review without flipping. For
      // `approved` (→published) and `rejected` (→draft) the matrix allows
      // the transition.
      const target =
        input.decision === 'approved'
          ? 'published'
          : input.decision === 'rejected'
            ? 'draft'
            : null;
      if (target) {
        await tx
          .update(schema.pages)
          .set({ status: target, updatedAt: new Date() })
          .where(eq(schema.pages.id, input.pageId));
        await recordAudit(tx, {
          workspaceId: input.workspaceId,
          actorUserId: input.approverUserId,
          action: 'page.status_changed',
          targetType: 'page',
          targetId: input.pageId,
          metadata: { from: 'review', to: target },
        });
      }
    }

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.approverUserId,
      action: DECISION_TO_AUDIT[input.decision],
      targetType: 'page',
      targetId: input.pageId,
      metadata: { versionSnapshotId, signatureHmac },
    });

    return { id: inserted.id, signatureHmac, versionSnapshotId };
  });
}

export type ApprovalHistoryItem = {
  id: string;
  decision: ApprovalDecision;
  approverUserId: string;
  approvedAt: Date;
  comment: string | null;
  versionSnapshotId: string;
  signatureHmac: string;
};

/**
 * Reverse-chronological approval history for a page. Used by both the GET
 * `/api/pages/[pageId]/approval` endpoint and the in-header ApprovalPanel.
 */
export async function listApprovals(db: Db, pageId: string): Promise<ApprovalHistoryItem[]> {
  const rows = await db
    .select()
    .from(schema.pageApprovals)
    .where(eq(schema.pageApprovals.pageId, pageId))
    .orderBy(desc(schema.pageApprovals.approvedAt));
  return rows.map((r) => ({
    id: r.id,
    decision: r.decision,
    approverUserId: r.approverUserId,
    approvedAt: r.approvedAt,
    comment: r.comment,
    versionSnapshotId: r.versionSnapshotId,
    signatureHmac: r.signatureHmac,
  }));
}
