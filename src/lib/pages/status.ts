/**
 * v0.9.0 G4 P26 — page lifecycle status transition library.
 *
 * Single gate for every page status change. Enforces the allowed-transition
 * matrix from the spec (§2 G4 #29) — any other (from→to) pair (including
 * same-status no-ops) throws `IllegalStatusTransition`. Audit-and-mutate
 * inside one db.transaction so the audit row can never drift from the
 * mutation (spec §2.27).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

export class IllegalStatusTransition extends Error {
  constructor(
    public readonly from: schema.PageStatus,
    public readonly to: schema.PageStatus,
  ) {
    super(`illegal status transition ${from} → ${to}`);
    this.name = 'IllegalStatusTransition';
  }
}

/**
 * Allowed-transition matrix:
 *   draft     → review, archived
 *   review    → draft, published
 *   published → review, archived
 *   archived  → draft
 *
 * Note: `published` cannot jump directly back to `draft` — it must pass
 * through `review` first (audit-trail discipline).
 */
const ALLOWED: Record<schema.PageStatus, ReadonlySet<schema.PageStatus>> = {
  draft: new Set<schema.PageStatus>(['review', 'archived']),
  review: new Set<schema.PageStatus>(['draft', 'published']),
  published: new Set<schema.PageStatus>(['review', 'archived']),
  archived: new Set<schema.PageStatus>(['draft']),
};

export function canTransition(from: schema.PageStatus, to: schema.PageStatus): boolean {
  return ALLOWED[from]?.has(to) ?? false;
}

/**
 * Transition `pageId` to a new status.
 *
 * Throws:
 *   - `IllegalStatusTransition` when (from→to) is not in the matrix
 *     (same-status no-ops are intentionally treated as illegal — the UI
 *     should debounce, not the gate).
 *   - `Error('page not found')` when no row matches `pageId`.
 */
export async function transitionStatus(
  db: PostgresJsDatabase<typeof schema>,
  input: { pageId: string; to: schema.PageStatus; byUserId: string },
): Promise<{ status: schema.PageStatus }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: schema.pages.id,
        status: schema.pages.status,
        workspaceId: schema.pages.workspaceId,
      })
      .from(schema.pages)
      .where(eq(schema.pages.id, input.pageId))
      .limit(1);
    if (!row) throw new Error('page not found');

    const from = row.status as schema.PageStatus;
    if (!canTransition(from, input.to)) {
      throw new IllegalStatusTransition(from, input.to);
    }

    await tx
      .update(schema.pages)
      .set({ status: input.to, updatedAt: new Date() })
      .where(eq(schema.pages.id, input.pageId));

    await recordAudit(tx, {
      workspaceId: row.workspaceId,
      actorUserId: input.byUserId,
      action: 'page.status_changed',
      targetType: 'page',
      targetId: input.pageId,
      metadata: { from, to: input.to },
    });

    return { status: input.to };
  });
}
