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
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { notifyStatusChange } from '@/lib/notifications/create';
import { canTransition } from './status-rules';

export class IllegalStatusTransition extends Error {
  constructor(
    public readonly from: schema.PageStatus,
    public readonly to: schema.PageStatus,
  ) {
    super(`illegal status transition ${from} → ${to}`);
    this.name = 'IllegalStatusTransition';
  }
}

// The allowed-transition matrix + `canTransition` now live in the client-safe
// `./status-rules` module (so the status picker can import them without pulling
// this server-only file's audit→SIEM→prom-client graph into the browser).
// Imported for internal use by `transitionStatus` and re-exported for the many
// existing server importers.
export { canTransition };

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
  const committed = await db.transaction(async (tx) => {
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

    return { status: input.to, workspaceId: row.workspaceId };
  });

  // v0.9.9 Plan I (#195) — notify page collaborators (distinct prior version
  // authors) of the status change. Post-commit, fresh getDb(), best-effort.
  try {
    const fresh = getDb();
    const authors = await fresh
      .selectDistinct({ authorId: schema.pageVersions.authorId })
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.pageId, input.pageId));
    const recipientIds = authors.map((r) => r.authorId).filter((id): id is string => id != null);
    await notifyStatusChange(fresh, {
      actorId: input.byUserId,
      pageId: input.pageId,
      workspaceId: committed.workspaceId,
      status: input.to,
      recipientIds,
    });
  } catch {
    // swallow — notification is best-effort.
  }

  return { status: committed.status };
}
