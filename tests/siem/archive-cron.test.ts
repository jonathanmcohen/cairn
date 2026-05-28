/**
 * v0.9.0 G8 P40 — daily S3 NDJSON archive cron sweep.
 *
 * Asserts `runDailyS3Archives(now)` iterates every enabled `kind='s3'`
 * forwarder, archives YESTERDAY's audit rows via a stub `archive` fn, and
 * persists one `siem_delivery_log` row per non-empty archive.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { runDailyS3Archives } from '@/lib/siem/archive';
import { startPostgres, stopPostgres } from '../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(48);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.CAIRN_DISABLE_SIEM_HOOK = '1';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE
    siem_delivery_log, siem_forwarders, audit_log, workspace_members, workspaces, users
    RESTART IDENTITY CASCADE`;
});

async function seedWorkspace(): Promise<{ workspaceId: string; userId: string }> {
  const [u] = await db
    .insert(schema.users)
    .values({ email: `u-${Math.random()}@x.com`, passwordHash: 'h', name: 'A' })
    .returning();
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!u || !ws) throw new Error('seed failed');
  return { workspaceId: ws.id, userId: u.id };
}

async function seedAuditAt(workspaceId: string, userId: string, at: Date, action: string) {
  await db.insert(schema.auditLog).values({
    workspaceId,
    actorUserId: userId,
    action,
    targetType: null,
    targetId: null,
    metadata: {},
    createdAt: at,
  });
}

describe('runDailyS3Archives', () => {
  it('archives yesterday for every enabled s3 forwarder + writes a success row', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    await db.insert(schema.siemForwarders).values({
      workspaceId,
      kind: 's3',
      name: 's3a',
      endpoint: 's3://cairn-test-bucket',
      options: { prefix: 'cairn' },
      enabled: true,
    });
    await seedAuditAt(workspaceId, userId, new Date('2026-05-26T10:00:00Z'), 'x');

    const archive = vi.fn().mockResolvedValue({
      rowCount: 1,
      bytes: 42,
      key: `cairn/${workspaceId}/audit/2026-05-26.ndjson.gz`,
    });
    const result = await runDailyS3Archives(new Date('2026-05-27T01:15:00Z'), { db, archive });

    expect(result.swept).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(archive).toHaveBeenCalledOnce();
    const arg = archive.mock.calls[0]?.[0] as { workspaceId: string; date: Date };
    expect(arg.workspaceId).toBe(workspaceId);

    const log = await db.select().from(schema.siemDeliveryLog);
    expect(log).toHaveLength(1);
    expect(log[0]?.status).toBe('success');
    expect(log[0]?.attempt).toBe(1);
  });

  it('writes a failed row when the archive fn throws', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    await db.insert(schema.siemForwarders).values({
      workspaceId,
      kind: 's3',
      name: 's3a',
      endpoint: 's3://cairn-test-bucket',
      options: {},
      enabled: true,
    });
    await seedAuditAt(workspaceId, userId, new Date('2026-05-26T10:00:00Z'), 'x');

    const archive = vi.fn().mockRejectedValue(new Error('AccessDenied'));
    const result = await runDailyS3Archives(new Date('2026-05-27T01:15:00Z'), { db, archive });
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);

    const log = await db.select().from(schema.siemDeliveryLog);
    expect(log).toHaveLength(1);
    expect(log[0]?.status).toBe('failed');
    expect(log[0]?.error).toContain('AccessDenied');
  });

  it('skips disabled forwarders', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    await db.insert(schema.siemForwarders).values({
      workspaceId,
      kind: 's3',
      name: 's3a',
      endpoint: 's3://cairn-test-bucket',
      options: {},
      enabled: false,
    });
    await seedAuditAt(workspaceId, userId, new Date('2026-05-26T10:00:00Z'), 'x');
    const archive = vi.fn();
    const result = await runDailyS3Archives(new Date('2026-05-27T01:15:00Z'), { db, archive });
    expect(result.swept).toBe(0);
    expect(archive).not.toHaveBeenCalled();
  });

  it('writes no log row when the day is empty (rowCount=0)', async () => {
    const { workspaceId } = await seedWorkspace();
    await db.insert(schema.siemForwarders).values({
      workspaceId,
      kind: 's3',
      name: 's3a',
      endpoint: 's3://cairn-test-bucket',
      options: {},
      enabled: true,
    });
    const archive = vi.fn().mockResolvedValue({ rowCount: 0, bytes: 0, key: null });
    const result = await runDailyS3Archives(new Date('2026-05-27T01:15:00Z'), { db, archive });
    expect(result.swept).toBe(1);
    expect(result.succeeded).toBe(0);
    const log = await db.select().from(schema.siemDeliveryLog);
    expect(log).toHaveLength(0);
  });

  it('ignores non-s3 forwarders', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    await db.insert(schema.siemForwarders).values({
      workspaceId,
      kind: 'http',
      name: 'webhook',
      endpoint: 'https://example.invalid',
      options: {},
      enabled: true,
    });
    await seedAuditAt(workspaceId, userId, new Date('2026-05-26T10:00:00Z'), 'x');
    const archive = vi.fn();
    const result = await runDailyS3Archives(new Date('2026-05-27T01:15:00Z'), { db, archive });
    expect(result.swept).toBe(0);
    expect(archive).not.toHaveBeenCalled();
  });
});
