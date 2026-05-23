import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Tx = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'update'>;

/**
 * Walk the parent chain upward from `startId` within the same database and
 * throw if it reaches `forbiddenId` (which would create a cycle). The proposed
 * edge is rowId -> parentId, so we start at parentId and forbid reaching rowId.
 * A self-parent (parentId === rowId) is caught immediately by the caller.
 */
async function assertNoCycle(tx: Tx, startId: string, forbiddenId: string): Promise<void> {
  const seen = new Set<string>();
  let cursor: string | null = startId;
  while (cursor !== null) {
    if (cursor === forbiddenId) {
      throw new Error('row cannot be its own ancestor (cycle)');
    }
    if (seen.has(cursor)) break; // defensive: pre-existing cycle in data — stop walking.
    seen.add(cursor);
    const [parent] = await tx
      .select({ parentRowId: schema.dbRows.parentRowId })
      .from(schema.dbRows)
      .where(eq(schema.dbRows.id, cursor))
      .limit(1);
    cursor = parent?.parentRowId ?? null;
  }
}

/**
 * Validate that `parentId` is a legal parent for `rowId`: both rows exist, both
 * live in the same database, and the edge introduces no ancestor cycle. Returns
 * nothing; throws on any violation. Pass `parentId: null` to clear (always legal
 * once the row exists). Re-usable from createRow/updateCells inside their txns.
 */
export async function validateParent(
  tx: Tx,
  input: { rowId: string; databaseId: string; parentId: string | null },
): Promise<void> {
  const [row] = await tx
    .select({ databaseId: schema.dbRows.databaseId })
    .from(schema.dbRows)
    .where(eq(schema.dbRows.id, input.rowId))
    .limit(1);
  if (!row || row.databaseId !== input.databaseId) {
    throw new Error('row not found in database');
  }
  if (input.parentId === null) return;
  if (input.parentId === input.rowId) {
    throw new Error('row cannot be its own ancestor (itself)');
  }
  const [parent] = await tx
    .select({ databaseId: schema.dbRows.databaseId })
    .from(schema.dbRows)
    .where(eq(schema.dbRows.id, input.parentId))
    .limit(1);
  if (!parent) throw new Error('parent row not found');
  if (parent.databaseId !== input.databaseId) {
    throw new Error('parent row must be in the same database');
  }
  await assertNoCycle(tx, input.parentId, input.rowId);
}

/**
 * Re-parent a row. Validates same-database membership and prevents ancestor
 * cycles, then writes `parent_row_id`. Runs inside the caller's transaction.
 */
export async function setRowParent(
  tx: PostgresJsDatabase<typeof schema>,
  input: { rowId: string; parentId: string | null },
): Promise<void> {
  const [row] = await tx
    .select({ databaseId: schema.dbRows.databaseId })
    .from(schema.dbRows)
    .where(eq(schema.dbRows.id, input.rowId))
    .limit(1);
  if (!row) throw new Error('row not found');

  await validateParent(tx, {
    rowId: input.rowId,
    databaseId: row.databaseId,
    parentId: input.parentId,
  });

  await tx
    .update(schema.dbRows)
    .set({ parentRowId: input.parentId, updatedAt: new Date() })
    .where(eq(schema.dbRows.id, input.rowId));
}
