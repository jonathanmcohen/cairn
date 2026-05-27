import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { recordAudit } from '@/lib/audit/record';
import { getDb } from '@/db/client';
import type * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type UpgradeAuditInput = {
  workspaceId: string;
  actorUserId?: string | null;
  db?: Db;
};

/**
 * Record `upgrade.applied`. Caller supplies the operator-chosen workspaceId
 * (audit_log.workspace_id is NOT NULL — see v0.6 P18 schema). The CLI passes
 * the workspace owning the operator's session; the compose wrapper passes
 * the first workspace it finds in the DB (admin convention).
 */
export async function auditUpgradeApplied(
  input: UpgradeAuditInput & {
    fromVersion: string;
    toVersion: string;
    migrationCount: number;
  },
): Promise<void> {
  const db = input.db ?? getDb();
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId ?? null,
    action: 'upgrade.applied',
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: {
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      migrationCount: input.migrationCount,
    },
  });
}

export async function auditUpgradeFailed(
  input: UpgradeAuditInput & {
    fromVersion: string;
    toVersion: string;
    error: string;
  },
): Promise<void> {
  const db = input.db ?? getDb();
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId ?? null,
    action: 'upgrade.failed',
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: {
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      error: input.error,
    },
  });
}

export async function auditUpgradeRolledBack(
  input: UpgradeAuditInput & { snapshotPath: string },
): Promise<void> {
  const db = input.db ?? getDb();
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId ?? null,
    action: 'upgrade.rolled_back',
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: { snapshotPath: input.snapshotPath },
  });
}
