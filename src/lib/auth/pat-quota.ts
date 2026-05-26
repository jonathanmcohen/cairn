import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
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

type TokenLimits = {
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  scopeRateLimits: Record<string, { perMinute: number }> | null;
};

async function loadLimits(
  db: PostgresJsDatabase<typeof schema>,
  tokenId: string,
): Promise<TokenLimits | null> {
  const [row] = await db
    .select({
      dailyRequestLimit: schema.personalAccessTokens.dailyRequestLimit,
      monthlyRequestLimit: schema.personalAccessTokens.monthlyRequestLimit,
      scopeRateLimits: schema.personalAccessTokens.scopeRateLimits,
    })
    .from(schema.personalAccessTokens)
    .where(eq(schema.personalAccessTokens.id, tokenId));
  return row ?? null;
}

async function readUsage(
  db: PostgresJsDatabase<typeof schema>,
  tokenId: string,
  windowKind: 'day' | 'month',
  windowStart: Date,
): Promise<number> {
  const [row] = await db
    .select({ requests: schema.patQuotaUsage.requests })
    .from(schema.patQuotaUsage)
    .where(
      and(
        eq(schema.patQuotaUsage.tokenId, tokenId),
        eq(schema.patQuotaUsage.windowKind, windowKind),
        eq(schema.patQuotaUsage.windowStart, windowStart),
      ),
    );
  return row?.requests ?? 0;
}

async function bumpUsage(
  db: PostgresJsDatabase<typeof schema>,
  tokenId: string,
  windowKind: 'day' | 'month',
  windowStart: Date,
): Promise<void> {
  // Atomic upsert: insert with requests=1 or increment if the (token, window)
  // row exists. The composite PK (token_id, window_start, window_kind) is the
  // conflict target — guards against the read-then-write race when two
  // concurrent requests both find usage<cap and race the increment.
  await db
    .insert(schema.patQuotaUsage)
    .values({ tokenId, windowKind, windowStart, requests: 1, bytes: 0 })
    .onConflictDoUpdate({
      target: [
        schema.patQuotaUsage.tokenId,
        schema.patQuotaUsage.windowStart,
        schema.patQuotaUsage.windowKind,
      ],
      set: { requests: sql`${schema.patQuotaUsage.requests} + 1` },
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
  const limits = await loadLimits(db, tokenId);
  if (!limits) return { allowed: true }; // token gone — caller will 401 separately

  const scopeLimit = limits.scopeRateLimits?.[scopeId];
  const bucket = consumeScopeBucket(tokenId, scopeId, scopeLimit, now.getTime());
  if (!bucket.allowed) {
    return { allowed: false, retryAfterSec: bucket.retryAfterSec };
  }

  const dayStart = dayWindowStart(now);
  const monthStart = monthWindowStart(now);

  if (limits.dailyRequestLimit !== null) {
    const used = await readUsage(db, tokenId, 'day', dayStart);
    if (used >= limits.dailyRequestLimit) {
      return { allowed: false, retryAfterSec: nextDayBoundarySec(now) };
    }
  }
  if (limits.monthlyRequestLimit !== null) {
    const used = await readUsage(db, tokenId, 'month', monthStart);
    if (used >= limits.monthlyRequestLimit) {
      return { allowed: false, retryAfterSec: nextMonthBoundarySec(now) };
    }
  }

  // All caps cleared — bump both window rollups so future calls see the
  // latest counts. Two upserts; both share the composite PK so there is no
  // cross-row conflict.
  await bumpUsage(db, tokenId, 'day', dayStart);
  await bumpUsage(db, tokenId, 'month', monthStart);
  return { allowed: true };
}
