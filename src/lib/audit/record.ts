import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { AuditAction, AuditTargetType } from './actions';

export type { AuditAction, AuditTargetType } from './actions';
export { AUDIT_ACTIONS } from './actions';

export type RecordAuditInput = {
  workspaceId: string;
  actorUserId: string | null;
  action: AuditAction;
  targetType?: AuditTargetType | string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

// Accept either a top-level db or a transaction handle (same insert surface).
// Mirrors the pattern used by notifyMentions/resolveTarget: the
// PostgresJsTransaction returned by db.transaction() is a structural subtype
// of PostgresJsDatabase, so a single Db type works for both call sites.
type DbOrTx = PostgresJsDatabase<typeof schema>;

const FORBIDDEN_SUBSTRINGS = [
  'AUTH_SECRET',
  'cairn_whsec_',
  'cairn_sk_',
  'token_hash',
  'password_hash',
  'secret_encrypted',
] as const;

const SECRET_ISH_KEY = /(secret|token|password|api[_-]?key|auth)/i;
const LONG_BASE64_ISH = /^[A-Za-z0-9+/_-]{24,}={0,2}$/;

/**
 * Defense-in-depth guard: audit metadata is operator-visible (admin console,
 * exports). Callers should pass ids / role-names / flags only. If anything
 * resembling a secret slips in, throw — better a noisy 500 in dev than a
 * silently logged secret in prod.
 */
export function assertAuditMetadataClean(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;
  const authSecret = process.env.AUTH_SECRET;

  function check(value: unknown, keyHint: string | null): void {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      for (const needle of FORBIDDEN_SUBSTRINGS) {
        if (value.includes(needle)) {
          throw new Error(`audit metadata contains forbidden substring "${needle}"`);
        }
      }
      if (authSecret && authSecret.length >= 8 && value.includes(authSecret)) {
        throw new Error('audit metadata contains AUTH_SECRET value');
      }
      if (keyHint && SECRET_ISH_KEY.test(keyHint) && LONG_BASE64_ISH.test(value)) {
        throw new Error(`audit metadata key "${keyHint}" looks secret-ish with a base64-ish value`);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) check(item, keyHint);
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        for (const needle of FORBIDDEN_SUBSTRINGS) {
          if (k.includes(needle)) {
            throw new Error(`audit metadata key contains forbidden substring "${needle}"`);
          }
        }
        check(v, k);
      }
    }
  }

  for (const [k, v] of Object.entries(metadata)) {
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      if (k.includes(needle)) {
        throw new Error(`audit metadata key contains forbidden substring "${needle}"`);
      }
    }
    check(v, k);
  }
}

/**
 * Append an audit-log row. Call this INSIDE the transaction that performed the
 * action so the log can never drift from the action (spec §2.27).
 *
 * Returns the inserted row so callers can surface row.id / row.createdAt in
 * UI/responses without a follow-up SELECT.
 *
 * Never put secrets in `metadata` — ids / role-names / flags only. The
 * `assertAuditMetadataClean` guard is defense-in-depth, not a substitute for
 * caller discipline.
 */
export async function recordAudit(
  tx: DbOrTx,
  input: RecordAuditInput,
): Promise<typeof schema.auditLog.$inferSelect> {
  assertAuditMetadataClean(input.metadata);
  const [row] = await tx
    .insert(schema.auditLog)
    .values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
    })
    .returning();
  if (!row) throw new Error('recordAudit: insert returned no row');
  return row;
}
