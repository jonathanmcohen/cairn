import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { dayWindowStart, monthWindowStart } from './pat-quota-windows';

/**
 * Workspace-admin row shape for the PAT dashboard. NEVER includes
 * `tokenHash`/`tokenPrefix`/plaintext — only metadata + usage rollups.
 * v0.9.0 G1 P10.
 */
export type PatAdminRow = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string;
  scopes: string[];
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  scopeRateLimits: Record<string, { perMinute: number }> | null;
  lastUsedAt: Date | null;
  currentDayUsage: number;
  currentMonthUsage: number;
  last14Days: number[];
  createdAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Return every active (non-revoked) PAT for `workspaceId` joined to owner
 * user info, with the active-day + active-month usage counters and a
 * 14-element oldest-first array of the last 14 daily request counts
 * (missing days zero-filled).
 *
 * Pure server function — no auth check. The caller (admin route + RSC page)
 * MUST gate on `requireRole('admin')` and ensure `workspaceId` matches the
 * caller's active workspace (cross-workspace returns 404, existence-hiding).
 */
export async function listWorkspacePats(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<PatAdminRow[]> {
  const tokens = await db
    .select({
      id: schema.personalAccessTokens.id,
      name: schema.personalAccessTokens.name,
      ownerId: schema.personalAccessTokens.userId,
      ownerName: schema.users.name,
      ownerEmail: schema.users.email,
      scopes: schema.personalAccessTokens.scopes,
      dailyRequestLimit: schema.personalAccessTokens.dailyRequestLimit,
      monthlyRequestLimit: schema.personalAccessTokens.monthlyRequestLimit,
      scopeRateLimits: schema.personalAccessTokens.scopeRateLimits,
      lastUsedAt: schema.personalAccessTokens.lastUsedAt,
      createdAt: schema.personalAccessTokens.createdAt,
    })
    .from(schema.personalAccessTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.personalAccessTokens.userId))
    .where(
      and(
        eq(schema.personalAccessTokens.workspaceId, workspaceId),
        isNull(schema.personalAccessTokens.revokedAt),
      ),
    )
    .orderBy(desc(schema.personalAccessTokens.createdAt));

  if (tokens.length === 0) return [];

  const tokenIds = tokens.map((t) => t.id);
  const today = dayWindowStart(new Date());
  const monthStart = monthWindowStart(new Date());
  const earliest = new Date(today.getTime() - 13 * DAY_MS);

  // Pull every usage row for these tokens since `earliest`. The current-month
  // row (always >= the 1st of the month) is covered because monthStart >=
  // today - 30d > today - 13d only sometimes — so include rows where the
  // month-start lies on or after `earliest` OR matches the active month-start
  // exactly. Simpler: fetch with windowStart >= min(earliest, monthStart).
  const fetchFrom = earliest.getTime() < monthStart.getTime() ? earliest : monthStart;

  const usageRows = await db
    .select()
    .from(schema.patQuotaUsage)
    .where(
      and(
        inArray(schema.patQuotaUsage.tokenId, tokenIds),
        gte(schema.patQuotaUsage.windowStart, fetchFrom),
      ),
    );

  const usageByToken = new Map<string, schema.PatQuotaUsage[]>();
  for (const u of usageRows) {
    const arr = usageByToken.get(u.tokenId) ?? [];
    arr.push(u);
    usageByToken.set(u.tokenId, arr);
  }

  return tokens.map((t) => {
    const rows = usageByToken.get(t.id) ?? [];
    const last14Days: number[] = new Array(14).fill(0);
    for (const u of rows) {
      if (u.windowKind !== 'day') continue;
      const diffDays = Math.round((today.getTime() - u.windowStart.getTime()) / DAY_MS);
      const idx = 13 - diffDays;
      if (idx >= 0 && idx < 14) last14Days[idx] = u.requests;
    }
    const currentDayUsage =
      rows.find((u) => u.windowKind === 'day' && u.windowStart.getTime() === today.getTime())
        ?.requests ?? 0;
    const currentMonthUsage =
      rows.find((u) => u.windowKind === 'month' && u.windowStart.getTime() === monthStart.getTime())
        ?.requests ?? 0;
    return {
      id: t.id,
      name: t.name,
      ownerId: t.ownerId,
      ownerName: t.ownerName,
      ownerEmail: t.ownerEmail,
      scopes: t.scopes,
      dailyRequestLimit: t.dailyRequestLimit,
      monthlyRequestLimit: t.monthlyRequestLimit,
      scopeRateLimits: t.scopeRateLimits,
      lastUsedAt: t.lastUsedAt,
      currentDayUsage,
      currentMonthUsage,
      last14Days,
      createdAt: t.createdAt,
    };
  });
}
