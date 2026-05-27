import { and, eq, max, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

/**
 * v0.9.0 G2 P12 — Workspace-pinned pages CRUD.
 *
 * `requireRole('admin')` guards the HTTP layer; this module is the
 * library layer (db-injected, pure-ish). Cross-workspace `pageId` throws
 * `PinNotFoundError` (mapped to 404 by the route layer — existence hiding).
 *
 * All mutations write an audit row in the same transaction as the mutation
 * (retrospective lesson from v0.8.0 / v0.9.0 — audit can never drift from
 * action when they share a tx).
 */
export class PinNotFoundError extends Error {
  constructor() {
    super('not_found');
    this.name = 'PinNotFoundError';
  }
}

export type AddPinInput = { workspaceId: string; pageId: string; actorId: string };

/**
 * Append a pin at the next available position, or return the existing pin
 * unchanged (idempotent). Cross-workspace `pageId` → `PinNotFoundError`.
 */
export async function addPin(
  db: PostgresJsDatabase<typeof schema>,
  input: AddPinInput,
): Promise<schema.WorkspacePin> {
  // Verify the page belongs to this workspace (cross-workspace → 404).
  const [page] = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(and(eq(schema.pages.id, input.pageId), eq(schema.pages.workspaceId, input.workspaceId)));
  if (!page) throw new PinNotFoundError();

  // Idempotent: a repeated add returns the existing row unchanged. The
  // PRIMARY KEY on (workspace_id, page_id) is the source of truth — this
  // pre-check just lets us return a cleanly-typed row without an exception.
  const [existing] = await db
    .select()
    .from(schema.workspacePins)
    .where(
      and(
        eq(schema.workspacePins.workspaceId, input.workspaceId),
        eq(schema.workspacePins.pageId, input.pageId),
      ),
    );
  if (existing) return existing;

  return await db.transaction(async (tx) => {
    const posRows = (await tx
      .select({
        nextPos: sql<number>`COALESCE(${max(schema.workspacePins.position)}, -1) + 1`,
      })
      .from(schema.workspacePins)
      .where(eq(schema.workspacePins.workspaceId, input.workspaceId))) as Array<{
      nextPos: number;
    }>;
    const nextPos = posRows[0]?.nextPos ?? 0;

    const [row] = await tx
      .insert(schema.workspacePins)
      .values({
        workspaceId: input.workspaceId,
        pageId: input.pageId,
        pinnedBy: input.actorId,
        position: Number(nextPos),
      })
      .onConflictDoNothing()
      .returning();

    if (!row) {
      // Raced with a concurrent add — re-fetch and return the winner.
      const [winner] = await tx
        .select()
        .from(schema.workspacePins)
        .where(
          and(
            eq(schema.workspacePins.workspaceId, input.workspaceId),
            eq(schema.workspacePins.pageId, input.pageId),
          ),
        );
      if (!winner) throw new Error('addPin: insert + re-fetch both missed');
      return winner;
    }

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorId,
      action: 'workspace.pin_added',
      targetType: 'page',
      targetId: row.pageId,
      metadata: { position: row.position },
    });
    return row;
  });
}

export async function removePin(
  db: PostgresJsDatabase<typeof schema>,
  input: AddPinInput,
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const result = await tx
      .delete(schema.workspacePins)
      .where(
        and(
          eq(schema.workspacePins.workspaceId, input.workspaceId),
          eq(schema.workspacePins.pageId, input.pageId),
        ),
      )
      .returning();
    if (result.length === 0) return false;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorId,
      action: 'workspace.pin_removed',
      targetType: 'page',
      targetId: input.pageId,
      metadata: {},
    });
    return true;
  });
}

export type ReorderPinsInput = {
  workspaceId: string;
  actorId: string;
  orderedPageIds: string[];
};

/**
 * Rewrite positions 0..N in the given order. Validates every id is
 * currently pinned in this workspace; anything else throws so the route
 * layer can return 400. Wrapped in a single transaction so a partial
 * rewrite never lands.
 */
export async function reorderPins(
  db: PostgresJsDatabase<typeof schema>,
  input: ReorderPinsInput,
): Promise<void> {
  const existing = await db
    .select({ pageId: schema.workspacePins.pageId })
    .from(schema.workspacePins)
    .where(eq(schema.workspacePins.workspaceId, input.workspaceId));
  const knownPinned = new Set(existing.map((r) => r.pageId));
  for (const id of input.orderedPageIds) {
    if (!knownPinned.has(id)) {
      throw new Error(`not_pinned:${id}`);
    }
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < input.orderedPageIds.length; i++) {
      const pageId = input.orderedPageIds[i];
      if (!pageId) continue;
      await tx
        .update(schema.workspacePins)
        .set({ position: i })
        .where(
          and(
            eq(schema.workspacePins.workspaceId, input.workspaceId),
            eq(schema.workspacePins.pageId, pageId),
          ),
        );
    }
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorId,
      action: 'workspace.pins_reordered',
      targetType: 'workspace',
      targetId: input.workspaceId,
      metadata: { count: input.orderedPageIds.length },
    });
  });
}
