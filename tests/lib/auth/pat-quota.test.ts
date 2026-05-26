import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
import { checkQuota, resetQuotaAuditThrottleForTests } from '@/lib/auth/pat-quota';
import { resetScopeBucketsForTests } from '@/lib/auth/pat-scope-bucket';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pat_quota_usage, personal_access_tokens, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  resetScopeBucketsForTests();
  resetQuotaAuditThrottleForTests();
});

async function seedTokenWithLimits(args: {
  daily?: number;
  monthly?: number;
  scopeRateLimits?: Record<string, { perMinute: number }>;
}): Promise<string> {
  const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
  const { row } = await mintPat(db, {
    userId: u.userId,
    workspaceId: u.workspaceId,
    name: 't',
    scopes: ['pages:read', 'pages:write'],
    mcpTools: [],
    expiresAt: null,
  });
  await db
    .update(schema.personalAccessTokens)
    .set({
      dailyRequestLimit: args.daily ?? null,
      monthlyRequestLimit: args.monthly ?? null,
      scopeRateLimits: args.scopeRateLimits ?? null,
    })
    .where(eq(schema.personalAccessTokens.id, row.id));
  return row.id;
}

describe('checkQuota', () => {
  it('allows when no limits configured', async () => {
    const tokenId = await seedTokenWithLimits({});
    const r = await checkQuota(db, tokenId, 'pages:read');
    expect(r.allowed).toBe(true);
  });

  it('ticks the rollup row on each allowed call', async () => {
    const tokenId = await seedTokenWithLimits({ daily: 100 });
    await checkQuota(db, tokenId, 'pages:read');
    await checkQuota(db, tokenId, 'pages:read');
    const usage = await db
      .select()
      .from(schema.patQuotaUsage)
      .where(eq(schema.patQuotaUsage.tokenId, tokenId));
    const dayRow = usage.find((u) => u.windowKind === 'day');
    expect(dayRow?.requests).toBe(2);
    const monthRow = usage.find((u) => u.windowKind === 'month');
    expect(monthRow?.requests).toBe(2);
  });

  it('returns 429 + Retry-After when daily cap hit', async () => {
    const tokenId = await seedTokenWithLimits({ daily: 1 });
    expect((await checkQuota(db, tokenId, 'pages:read')).allowed).toBe(true);
    const r = await checkQuota(db, tokenId, 'pages:read');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfterSec).toBeGreaterThan(0);
      expect(r.retryAfterSec).toBeLessThanOrEqual(86_400);
    }
  });

  it('returns 429 when monthly cap hit even if daily would allow', async () => {
    const tokenId = await seedTokenWithLimits({ daily: 1000, monthly: 1 });
    expect((await checkQuota(db, tokenId, 'pages:read')).allowed).toBe(true);
    const r = await checkQuota(db, tokenId, 'pages:read');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('resets at day boundary', async () => {
    // Use the injectable `now` parameter — vi.useFakeTimers deadlocks postgres-js.
    const day1 = new Date('2026-05-26T23:59:00Z');
    const day2 = new Date('2026-05-27T00:00:30Z');
    const tokenId = await seedTokenWithLimits({ daily: 1 });
    expect((await checkQuota(db, tokenId, 'pages:read', day1)).allowed).toBe(true);
    expect((await checkQuota(db, tokenId, 'pages:read', day1)).allowed).toBe(false);
    // Next day's window is a different (token, windowStart) row → fresh count.
    expect((await checkQuota(db, tokenId, 'pages:read', day2)).allowed).toBe(true);
  });

  it('enforces scope-specific perMinute bucket independently of daily', async () => {
    const tokenId = await seedTokenWithLimits({
      daily: 1000,
      scopeRateLimits: { 'pages:write': { perMinute: 1 } },
    });
    expect((await checkQuota(db, tokenId, 'pages:write')).allowed).toBe(true);
    const r = await checkQuota(db, tokenId, 'pages:write');
    expect(r.allowed).toBe(false);
    // pages:read has no scope limit and is well under daily — still allowed
    expect((await checkQuota(db, tokenId, 'pages:read')).allowed).toBe(true);
  });

  it('does NOT tick rollup when 429 from scope bucket', async () => {
    const tokenId = await seedTokenWithLimits({
      daily: 1000,
      scopeRateLimits: { 'pages:write': { perMinute: 1 } },
    });
    await checkQuota(db, tokenId, 'pages:write');
    await checkQuota(db, tokenId, 'pages:write'); // 429 — no tick
    const usage = await db
      .select()
      .from(schema.patQuotaUsage)
      .where(eq(schema.patQuotaUsage.tokenId, tokenId));
    const dayRow = usage.find((u) => u.windowKind === 'day');
    expect(dayRow?.requests).toBe(1);
  });

  it('does NOT tick rollup when daily cap exceeded', async () => {
    const tokenId = await seedTokenWithLimits({ daily: 1 });
    await checkQuota(db, tokenId, 'pages:read'); // allowed, tick → 1
    await checkQuota(db, tokenId, 'pages:read'); // 429 → no tick
    const usage = await db
      .select()
      .from(schema.patQuotaUsage)
      .where(eq(schema.patQuotaUsage.tokenId, tokenId));
    const dayRow = usage.find((u) => u.windowKind === 'day');
    expect(dayRow?.requests).toBe(1);
  });

  it('returns allowed=true for an unknown tokenId (caller will 401 separately)', async () => {
    const r = await checkQuota(db, '00000000-0000-0000-0000-000000000000', 'pages:read');
    expect(r.allowed).toBe(true);
  });

  it('records pat.quota_exceeded audit on 429 (daily cap)', async () => {
    const tokenId = await seedTokenWithLimits({ daily: 1 });
    await checkQuota(db, tokenId, 'pages:read'); // allowed
    await checkQuota(db, tokenId, 'pages:read'); // 429 → audit
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'pat.quota_exceeded'));
    expect(audits.length).toBe(1);
    const audit = audits[0];
    expect(audit?.targetType).toBe('personal_access_token');
    expect(audit?.targetId).toBe(tokenId);
    const meta = audit?.metadata as Record<string, unknown>;
    expect(meta.scope).toBe('pages:read');
    expect(meta.reason).toBe('day');
    // PAT secrets must never appear in audit metadata.
    expect(JSON.stringify(meta)).not.toContain('cairn_pat_');
  });

  it('throttles audit rows to at most one per minute per (token, reason)', async () => {
    const tokenId = await seedTokenWithLimits({ daily: 1 });
    await checkQuota(db, tokenId, 'pages:read');
    // Three more 429 calls in quick succession → only one audit row.
    await checkQuota(db, tokenId, 'pages:read');
    await checkQuota(db, tokenId, 'pages:read');
    await checkQuota(db, tokenId, 'pages:read');
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'pat.quota_exceeded'));
    expect(audits.length).toBe(1);
  });
});
