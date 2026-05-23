import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { QuotaExceededError } from './errors';

type Db = PostgresJsDatabase<typeof schema>;

/** Lazily create (idempotent) and return the quota row for a workspace. */
export async function ensureQuotaRow(db: Db, workspaceId: string): Promise<schema.WorkspaceQuota> {
  await db
    .insert(schema.workspaceQuotas)
    .values({ workspaceId })
    .onConflictDoNothing({ target: schema.workspaceQuotas.workspaceId });
  const [row] = await db
    .select()
    .from(schema.workspaceQuotas)
    .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
  if (!row) throw new Error('quota row missing after ensure');
  return row;
}

/**
 * Throw QuotaExceededError when used + incoming > limit. A null limit is
 * unlimited. Lazily ensures the row first so a brand-new workspace never blocks.
 */
export async function checkStorageQuota(
  db: Db,
  args: { workspaceId: string; incomingBytes: number },
): Promise<void> {
  const row = await ensureQuotaRow(db, args.workspaceId);
  if (row.storageBytesLimit === null) return;
  if (row.storageBytesUsed + args.incomingBytes > row.storageBytesLimit) {
    throw new QuotaExceededError({
      limit: row.storageBytesLimit,
      used: row.storageBytesUsed,
      incoming: args.incomingBytes,
    });
  }
}

export async function incrementStorageUsed(
  db: Db,
  workspaceId: string,
  bytes: number,
): Promise<void> {
  await ensureQuotaRow(db, workspaceId);
  await db
    .update(schema.workspaceQuotas)
    .set({
      storageBytesUsed: sql`${schema.workspaceQuotas.storageBytesUsed} + ${bytes}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
}

/** Decrement, clamped at zero. */
export async function decrementStorageUsed(
  db: Db,
  workspaceId: string,
  bytes: number,
): Promise<void> {
  await ensureQuotaRow(db, workspaceId);
  await db
    .update(schema.workspaceQuotas)
    .set({
      storageBytesUsed: sql`GREATEST(${schema.workspaceQuotas.storageBytesUsed} - ${bytes}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
}

/**
 * Recompute storage_bytes_used from the canonical files.size sum and write it
 * back. Returns the reconciled value. The CLI `reconcile` subcommand (P21 T3+)
 * calls this per workspace.
 */
export async function reconcileQuota(db: Db, workspaceId: string): Promise<number> {
  await ensureQuotaRow(db, workspaceId);
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${schema.files.size}), 0)::bigint`,
    })
    .from(schema.files)
    .where(eq(schema.files.workspaceId, workspaceId));
  const used = Number(row?.total ?? 0);
  await db
    .update(schema.workspaceQuotas)
    .set({ storageBytesUsed: used, updatedAt: new Date() })
    .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
  return used;
}
