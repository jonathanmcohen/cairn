import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import {
  dayWindowStart,
  monthWindowStart,
  nextDayBoundarySec,
  nextMonthBoundarySec,
} from './pat-quota-windows';
import { consumeScopeBucket } from './pat-scope-bucket';

/**
 * Result of `checkQuota`. On `allowed: false` the caller emits a generic 429
 * + `Retry-After: <retryAfterSec>` Response — NEVER echoes back the
 * configured limit (info leak about other tokens).
 */
export type QuotaResult = { allowed: true } | { allowed: false; retryAfterSec: number };

type TokenContext = {
  workspaceId: string;
  userId: string;
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  scopeRateLimits: Record<string, { perMinute: number }> | null;
};

async function loadContext(
  db: PostgresJsDatabase<typeof schema>,
  tokenId: string,
): Promise<TokenContext | null> {
  const [row] = await db
    .select({
      workspaceId: schema.personalAccessTokens.workspaceId,
      userId: schema.personalAccessTokens.userId,
      dailyRequestLimit: schema.personalAccessTokens.dailyRequestLimit,
      monthlyRequestLimit: schema.personalAccessTokens.monthlyRequestLimit,
      scopeRateLimits: schema.personalAccessTokens.scopeRateLimits,
    })
    .from(schema.personalAccessTokens)
    .where(eq(schema.personalAccessTokens.id, tokenId));
  return row ?? null;
}

/**
 * Atomic insert-or-conditionally-bump. Returns the new `requests` count if the
 * write happened (within `limit`); returns `null` if the row already existed
 * with `requests >= limit` (the `WHERE` in the conflict update suppressed it).
 *
 * Closes the read-then-check-then-write race: two concurrent requests at
 * usage=99/limit=100 cannot both observe usage<limit and both bump to 101.
 * Drizzle's `onConflictDoUpdate` has no `setWhere` so we go via raw SQL.
 *
 * If `limit` is null the cap is unbounded — degenerate to an unconditional
 * upsert (still atomic, just no rejection branch).
 */
async function tryBumpUsage(
  db: PostgresJsDatabase<typeof schema>,
  tokenId: string,
  windowKind: 'day' | 'month',
  windowStart: Date,
  limit: number | null,
): Promise<number | null> {
  const conflictUpdate =
    limit === null
      ? sql`ON CONFLICT ("token_id", "window_start", "window_kind") DO UPDATE
             SET requests = pat_quota_usage.requests + 1`
      : sql`ON CONFLICT ("token_id", "window_start", "window_kind") DO UPDATE
             SET requests = pat_quota_usage.requests + 1
             WHERE pat_quota_usage.requests < ${limit}`;
  // postgres-js bind: Drizzle's `sql` tag passes Date objects through unchanged,
  // but postgres-js@3.4 refuses non-string args on raw query parameters
  // (`TypeError: The "string" argument must be of type string ...`). Serialize
  // to ISO string explicitly; the column is `timestamptz`, which accepts ISO.
  const windowStartIso = windowStart.toISOString();
  const result = await db.execute(sql`
    INSERT INTO pat_quota_usage ("token_id", "window_start", "window_kind", "requests", "bytes")
    VALUES (${tokenId}, ${windowStartIso}, ${windowKind}, 1, 0)
    ${conflictUpdate}
    RETURNING requests
  `);
  const rows = result as unknown as Array<{ requests: number }>;
  if (rows.length === 0) return null;
  return rows[0]?.requests ?? null;
}

/**
 * In-process throttle for `pat.quota_exceeded` audit rows: a misbehaving
 * client that retries thousands of times against an exhausted quota must not
 * flood the audit log. Emit at most once per minute per (token, reason).
 */
const auditThrottle = new Map<string, number>();
const AUDIT_THROTTLE_MS = 60_000;

function shouldRecordAudit(tokenId: string, reason: string, nowMs: number): boolean {
  const key = `${tokenId}::${reason}`;
  const last = auditThrottle.get(key) ?? 0;
  if (nowMs - last < AUDIT_THROTTLE_MS) return false;
  auditThrottle.set(key, nowMs);
  return true;
}

/** Test-only: clear the audit throttle map between tests. */
export function resetQuotaAuditThrottleForTests(): void {
  auditThrottle.clear();
}

async function auditCap(
  db: PostgresJsDatabase<typeof schema>,
  ctx: TokenContext,
  tokenId: string,
  scopeId: string,
  reason: 'day' | 'month' | 'scope',
  nowMs: number,
): Promise<void> {
  if (!shouldRecordAudit(tokenId, reason, nowMs)) return;
  // Metadata MUST NOT carry the PAT secret / hash / prefix — only ids + the
  // reason enum (assertAuditMetadataClean is defense-in-depth).
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'pat.quota_exceeded',
    targetType: 'personal_access_token',
    targetId: tokenId,
    metadata: { scope: scopeId, reason },
  }).catch(() => {
    // Audit failure must not block the 429 response. Swallow silently — admin
    // dashboards still surface the rollup counters.
  });
}

/**
 * Check + atomically bump the quota for `tokenId` on `scopeId`. Returns
 * `{allowed: true}` and increments the rollup on success; returns
 * `{allowed: false, retryAfterSec}` and does NOT increment on cap hit.
 *
 * Order of checks (cheapest first):
 *   1) in-process scope bucket (perMinute) — no DB round-trip
 *   2) DB-backed daily cap
 *   3) DB-backed monthly cap
 *
 * On any cap hit, records a `pat.quota_exceeded` audit row (throttled to at
 * most once per minute per (token, reason) to keep the audit log
 * proportional to a misbehaving client's actual concerning behavior).
 *
 * `now` is injectable so window-boundary tests can pin time without
 * `vi.useFakeTimers` (which deadlocks postgres-js).
 *
 * v0.9.0 G1 P9 — call site is `dispatchPat` in `src/lib/auth/pat.ts`.
 */
export async function checkQuota(
  db: PostgresJsDatabase<typeof schema>,
  tokenId: string,
  scopeId: string,
  now: Date = new Date(),
): Promise<QuotaResult> {
  const ctx = await loadContext(db, tokenId);
  if (!ctx) return { allowed: true }; // token gone — caller will 401 separately
  const nowMs = now.getTime();

  const scopeLimit = ctx.scopeRateLimits?.[scopeId];
  const bucket = consumeScopeBucket(tokenId, scopeId, scopeLimit, nowMs);
  if (!bucket.allowed) {
    await auditCap(db, ctx, tokenId, scopeId, 'scope', nowMs);
    return { allowed: false, retryAfterSec: bucket.retryAfterSec };
  }

  const dayStart = dayWindowStart(now);
  const monthStart = monthWindowStart(now);

  // Each window is independently atomic. If the day cap is hit we reject
  // without touching the month rollup; if the day bump succeeds but the month
  // cap is hit we reject with month — the (now-consumed) day tick is fine,
  // future calls in the same day will hit the day cap first anyway.
  const dayBumped = await tryBumpUsage(db, tokenId, 'day', dayStart, ctx.dailyRequestLimit);
  if (dayBumped === null) {
    await auditCap(db, ctx, tokenId, scopeId, 'day', nowMs);
    return { allowed: false, retryAfterSec: nextDayBoundarySec(now) };
  }
  const monthBumped = await tryBumpUsage(db, tokenId, 'month', monthStart, ctx.monthlyRequestLimit);
  if (monthBumped === null) {
    await auditCap(db, ctx, tokenId, scopeId, 'month', nowMs);
    return { allowed: false, retryAfterSec: nextMonthBoundarySec(now) };
  }
  return { allowed: true };
}
