import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// biome-ignore lint/suspicious/noExplicitAny: drizzle handle is opaque at this layer; tests + apply pass schema'd handles.
type AnyDb = PostgresJsDatabase<any>;

/**
 * Minimal audit-writer used by the cairn-upgrade CLI. The richer
 * `recordAudit` (src/lib/audit/record.ts) is reserved for in-app callers
 * because it transitively imports `@/db/schema`, `@/lib/siem/dispatch`,
 * and other Next-runtime-only modules that won't resolve under `node
 * dist/server/upgrade-cli.js`.
 *
 * Inserts a single audit_log row via raw SQL. The CLI must pass a
 * connected drizzle handle (or rely on the databaseUrl-based fallback for
 * one-shot CLI invocations).
 */
export type UpgradeAuditInput = {
  workspaceId: string;
  actorUserId?: string | null;
  /** Optional pre-built drizzle handle. Otherwise an ad-hoc connection is opened. */
  db?: AnyDb;
  /** Fallback for ad-hoc connections (only used when `db` is omitted). */
  databaseUrl?: string;
};

async function insertAudit(
  input: UpgradeAuditInput & {
    action: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const insert = async (db: AnyDb): Promise<void> => {
    await db.execute(sql`
      INSERT INTO audit_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
      VALUES (
        ${input.workspaceId}::uuid,
        ${input.actorUserId ?? null}::uuid,
        ${input.action},
        ${'workspace'},
        ${input.workspaceId}::uuid,
        ${JSON.stringify(input.metadata)}::jsonb
      )
    `);
  };

  if (input.db) {
    await insert(input.db);
    return;
  }
  if (!input.databaseUrl) {
    throw new Error('auditUpgrade*: either db or databaseUrl is required');
  }
  const client = postgres(input.databaseUrl, { max: 1 });
  try {
    await insert(drizzle(client));
  } finally {
    await client.end();
  }
}

/**
 * `upgrade.applied` -- recorded after a successful apply orchestration.
 * Metadata: { fromVersion, toVersion, migrationCount }.
 */
export async function auditUpgradeApplied(
  input: UpgradeAuditInput & {
    fromVersion: string;
    toVersion: string;
    migrationCount: number;
  },
): Promise<void> {
  await insertAudit({
    ...input,
    action: 'upgrade.applied',
    metadata: {
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      migrationCount: input.migrationCount,
    },
  });
}

/**
 * `upgrade.failed` -- recorded on any failure path (post-rollback).
 * Metadata: { fromVersion, toVersion, error }.
 */
export async function auditUpgradeFailed(
  input: UpgradeAuditInput & {
    fromVersion: string;
    toVersion: string;
    error: string;
  },
): Promise<void> {
  await insertAudit({
    ...input,
    action: 'upgrade.failed',
    metadata: {
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      error: input.error,
    },
  });
}

/**
 * `upgrade.rolled_back` -- recorded after a successful pg_restore from
 * snapshot. Metadata: { snapshotPath }.
 */
export async function auditUpgradeRolledBack(
  input: UpgradeAuditInput & { snapshotPath: string },
): Promise<void> {
  await insertAudit({
    ...input,
    action: 'upgrade.rolled_back',
    metadata: { snapshotPath: input.snapshotPath },
  });
}
