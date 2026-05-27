/**
 * v0.9.0 G8 P39 — SIEM dispatch fan-out.
 *
 * `dispatchAuditEvent` is the post-write hook. Every `audit_log` insert calls
 * it once; the dispatcher loads every enabled forwarder for the workspace,
 * builds the canonical envelope, and fans out via per-kind sender functions.
 * Each per-(forwarder, audit_event) attempt persists one row to
 * `siem_delivery_log` with `status in {success, retry, failed}`.
 *
 * Retry-attempt accounting reads the existing delivery rows for that
 * (forwarder, audit_event) pair: `attempt = prior.length + 1`. After the
 * configured MAX_ATTEMPTS the row is promoted to `failed` and a meta-audit
 * `siem.delivery_failed` is logged (but NOT re-dispatched — see the guard in
 * `recordAudit`).
 *
 * The dispatcher is best-effort: a sender throw is captured into the log,
 * never propagated to the caller. A top-level catch in the audit-write hook
 * absorbs anything else (a misconfigured forwarder must never roll back the
 * audit insert).
 *
 * Secret hygiene: forwarder rows carry `credential_secret` in plaintext (we
 * never log them; the central REDACT_PATHS scrubs `authorization`,
 * `*.secret`, etc.). The delivery-log `error` column is the sender's
 * `Error.message` — if a target writes a secret into its own error string
 * the dispatcher cannot scrub it, so target implementations MUST keep their
 * error messages free of secrets (the HTTP target returns `HTTP <status>`
 * only; the syslog target throws plain Node error messages).
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { logger } from '@/lib/observability/logger';
import { isExhausted, nextBackoffMs } from './backoff';
import { formatAuditEvent, type SiemEnvelope } from './format';
import { sendHttp } from './targets/http';
import { sendSyslog } from './targets/syslog';

export type DispatchInput = {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type Sender = (
  forwarder: {
    endpoint: string;
    credentialSecret: string | null;
    options: Record<string, unknown>;
  },
  env: SiemEnvelope,
) => Promise<void>;

export const DEFAULT_SENDERS: Record<string, Sender> = {
  http: (f, env) => sendHttp(f, env),
  syslog: (f, env) => sendSyslog({ endpoint: f.endpoint, options: f.options }, env),
};

export type DispatchOptions = {
  senders?: Record<string, Sender>;
  /**
   * Test seam — lets a unit test inject a fake db handle. Production code
   * always uses the singleton from `getDb()`.
   */
  db?: ReturnType<typeof getDb>;
};

async function deliverOne(
  db: ReturnType<typeof getDb>,
  forwarder: schema.SiemForwarder,
  audit: DispatchInput,
  envelope: SiemEnvelope,
  senders: Record<string, Sender>,
): Promise<void> {
  const send = senders[forwarder.kind];
  if (!send) {
    logger.warn({ kind: forwarder.kind }, 'siem.sender_missing');
    return;
  }
  const prior = await db
    .select({ id: schema.siemDeliveryLog.id })
    .from(schema.siemDeliveryLog)
    .where(
      and(
        eq(schema.siemDeliveryLog.forwarderId, forwarder.id),
        eq(schema.siemDeliveryLog.auditEventId, audit.id),
      ),
    );
  const attempt = prior.length + 1;
  try {
    await send(
      {
        endpoint: forwarder.endpoint,
        credentialSecret: forwarder.credentialSecret,
        options: forwarder.options,
      },
      envelope,
    );
    await db.insert(schema.siemDeliveryLog).values({
      forwarderId: forwarder.id,
      auditEventId: audit.id,
      status: 'success',
      attempt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const exhausted = isExhausted(attempt + 1);
    await db.insert(schema.siemDeliveryLog).values({
      forwarderId: forwarder.id,
      auditEventId: audit.id,
      status: exhausted ? 'failed' : 'retry',
      attempt,
      error: msg,
      nextAttemptAt: exhausted ? null : new Date(Date.now() + nextBackoffMs(attempt)),
    });
    if (exhausted) {
      logger.error({ forwarderId: forwarder.id, auditEventId: audit.id }, 'siem.delivery_failed');
    }
  }
}

export async function dispatchAuditEvent(
  audit: DispatchInput,
  opts: DispatchOptions = {},
): Promise<void> {
  // Guard against meta-audit recursion: a `siem.delivery_failed` event must
  // not itself fan out to forwarders (a perpetually dead forwarder would
  // create an infinite loop). The plan documents this at task 5 step 3.
  if (audit.action === 'siem.delivery_failed') return;

  const senders = opts.senders ?? DEFAULT_SENDERS;
  const db = opts.db ?? getDb();
  const envelope = formatAuditEvent(audit);

  const forwarders = await db
    .select()
    .from(schema.siemForwarders)
    .where(
      and(
        eq(schema.siemForwarders.workspaceId, audit.workspaceId),
        eq(schema.siemForwarders.enabled, true),
      ),
    );

  await Promise.all(forwarders.map((f) => deliverOne(db, f, audit, envelope, senders)));
}

/**
 * Best-effort wrapper for callers that do NOT want a SIEM dispatch failure to
 * surface as a route-handler 500. Logs and swallows. Called from the audit
 * recorder hook.
 */
export function dispatchAuditEventSafe(
  audit: DispatchInput,
  opts: DispatchOptions = {},
): Promise<void> {
  return dispatchAuditEvent(audit, opts).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'siem.dispatch_threw');
  });
}

/**
 * Cron retry sweep — called every 60s from the scheduler. Selects every
 * delivery-log row with `status='retry'` whose `next_attempt_at` is in the
 * past, looks up the underlying audit row + forwarder, and re-runs the
 * per-forwarder send.
 *
 * Implementation note: a stale forwarder that has since been deleted will
 * cascade-delete its rows; a stale audit row likewise cascades. We only need
 * to filter out rows where the forwarder is `enabled=false` (operator could
 * have toggled it after a retry was scheduled).
 */
export async function retryPendingDeliveries(
  opts: DispatchOptions = {},
): Promise<{ swept: number }> {
  const senders = opts.senders ?? DEFAULT_SENDERS;
  const db = opts.db ?? getDb();

  const due = await db
    .select({
      forwarder: schema.siemForwarders,
      audit: schema.auditLog,
    })
    .from(schema.siemDeliveryLog)
    .innerJoin(
      schema.siemForwarders,
      eq(schema.siemDeliveryLog.forwarderId, schema.siemForwarders.id),
    )
    .innerJoin(schema.auditLog, eq(schema.siemDeliveryLog.auditEventId, schema.auditLog.id))
    .where(eq(schema.siemDeliveryLog.status, 'retry'));

  const now = Date.now();
  let swept = 0;
  for (const row of due) {
    // Re-read the delivery rows for THIS (forwarder, audit) pair so we pick
    // up the latest attempt count + skip rows whose next_attempt_at is still
    // in the future (a `retry` written 10s ago with a 5m back-off should
    // wait). Filtering here keeps the SQL simple and avoids a partial-index
    // join that the planner doesn't always pick.
    const pending = await db
      .select()
      .from(schema.siemDeliveryLog)
      .where(
        and(
          eq(schema.siemDeliveryLog.forwarderId, row.forwarder.id),
          eq(schema.siemDeliveryLog.auditEventId, row.audit.id),
          eq(schema.siemDeliveryLog.status, 'retry'),
        ),
      );
    const ready = pending.some((p) => p.nextAttemptAt !== null && p.nextAttemptAt.getTime() <= now);
    if (!ready) continue;
    if (!row.forwarder.enabled) continue;

    await deliverOne(
      db,
      row.forwarder,
      {
        id: row.audit.id,
        workspaceId: row.audit.workspaceId,
        actorUserId: row.audit.actorUserId,
        action: row.audit.action,
        targetType: row.audit.targetType,
        targetId: row.audit.targetId,
        metadata: (row.audit.metadata ?? {}) as Record<string, unknown>,
        createdAt: row.audit.createdAt,
      },
      formatAuditEvent({
        id: row.audit.id,
        workspaceId: row.audit.workspaceId,
        actorUserId: row.audit.actorUserId,
        action: row.audit.action,
        targetType: row.audit.targetType,
        targetId: row.audit.targetId,
        metadata: (row.audit.metadata ?? {}) as Record<string, unknown>,
        createdAt: row.audit.createdAt,
      }),
      senders,
    );
    swept += 1;
  }
  return { swept };
}
