import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * Documented action vocabulary (spec §2.27). Stored as free text — this union
 * documents the values without a Postgres enum, so P18+ can add actions with no
 * migration. P17 emits the two workspace-lifecycle actions; P18 adds the rest.
 */
export type AuditAction =
  | 'workspace.ownership_transferred'
  | 'workspace.deleted'
  | 'workspace.settings_changed'
  | 'member.role_changed'
  | 'member.removed'
  | 'backup.created'
  // P18 extends this union with the remaining documented actions.
  | (string & {});

export type RecordAuditInput = {
  workspaceId: string;
  actorUserId: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

// Accept either a top-level db or a transaction handle (same insert surface).
// Mirrors the pattern used by notifyMentions/resolveTarget: the
// PostgresJsTransaction returned by db.transaction() is a structural subtype
// of PostgresJsDatabase, so a single Db type works for both call sites.
type DbOrTx = PostgresJsDatabase<typeof schema>;

/**
 * Append an audit-log row. Call this INSIDE the transaction that performed the
 * action so the log can never drift from the action (spec §2.27).
 *
 * STUB SCOPE (P17): a single insert. P18 wires this into every sensitive helper
 * + adds the viewer and the per-page activity feed (a view over this table).
 * Never put secrets in `metadata` — ids / role-names / flags only.
 */
export async function recordAudit(tx: DbOrTx, input: RecordAuditInput): Promise<void> {
  await tx.insert(schema.auditLog).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
    ip: input.ip ?? null,
  });
}
