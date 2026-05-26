import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
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
});

describe('mintPat with quota fields', () => {
  it('persists daily/monthly/scopeRateLimits when provided', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { row } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 't',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
      dailyRequestLimit: 1000,
      monthlyRequestLimit: 30_000,
      scopeRateLimits: { 'pages:read': { perMinute: 600 } },
    });
    expect(row.dailyRequestLimit).toBe(1000);
    expect(row.monthlyRequestLimit).toBe(30_000);
    expect(row.scopeRateLimits).toEqual({ 'pages:read': { perMinute: 600 } });
  });

  it('defaults the quota fields to null when omitted (back-compat)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { row } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 't',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
    });
    expect(row.dailyRequestLimit).toBeNull();
    expect(row.monthlyRequestLimit).toBeNull();
    expect(row.scopeRateLimits).toBeNull();
  });
});
