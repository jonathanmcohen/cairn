/**
 * v0.9.0 G8 P40 — `archiveDayToS3` selects a single UTC day of audit rows for a
 * workspace and writes a gzipped NDJSON object via the S3 client. The test
 * injects a stub S3 client so it never hits the network.
 */

import { gunzipSync } from 'node:zlib';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { archiveDayToS3 } from '@/lib/siem/targets/s3-archive';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
const sendMock = vi.fn();

const stubClient = { send: sendMock } as unknown as Parameters<
  typeof archiveDayToS3
>[0]['s3Client'];

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(48);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  // Don't let the audit recorder hook try to dispatch — the singleton getDb
  // would race the per-file pool. The archive function takes an explicit `db`.
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
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
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

describe('archiveDayToS3', () => {
  it('writes a gzipped NDJSON object for the requested day', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 's3',
        name: 's3a',
        endpoint: 's3://cairn-test-bucket',
        credentialSecret: null,
        options: { prefix: 'cairn' },
        enabled: true,
      })
      .returning();

    // Seed 3 audit events at 2026-05-26
    await db.transaction(async (tx) => {
      const dummy = await tx
        .insert(schema.auditLog)
        .values([
          {
            workspaceId,
            actorUserId: userId,
            action: 'a',
            targetType: null,
            targetId: null,
            metadata: {},
            createdAt: new Date('2026-05-26T08:00:00Z'),
          },
          {
            workspaceId,
            actorUserId: userId,
            action: 'b',
            targetType: null,
            targetId: null,
            metadata: {},
            createdAt: new Date('2026-05-26T12:00:00Z'),
          },
          {
            workspaceId,
            actorUserId: userId,
            action: 'c',
            targetType: null,
            targetId: null,
            metadata: {},
            createdAt: new Date('2026-05-26T23:59:00Z'),
          },
        ])
        .returning();
      void dummy;
    });

    const result = await archiveDayToS3({
      workspaceId,
      forwarderId: forwarder?.id ?? '',
      date: new Date('2026-05-26T00:00:00Z'),
      db,
      s3Client: stubClient,
    });
    expect(result.rowCount).toBe(3);
    expect(result.key).toBe(`cairn/${workspaceId}/audit/2026-05-26.ndjson.gz`);
    expect(sendMock).toHaveBeenCalledOnce();

    const cmd = sendMock.mock.calls[0]?.[0] as {
      input: { Bucket: string; Key: string; Body: Buffer };
    };
    expect(cmd.input.Bucket).toBe('cairn-test-bucket');
    expect(cmd.input.Key).toBe(`cairn/${workspaceId}/audit/2026-05-26.ndjson.gz`);

    const decompressed = gunzipSync(cmd.input.Body).toString('utf8');
    const lines = decompressed.trim().split('\n');
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as { action: string });
    const actions = parsed.map((p) => p.action).sort();
    expect(actions).toEqual(['a', 'b', 'c']);
  });

  it('skips audit rows in a different workspace', async () => {
    const a = await seedWorkspace();
    const b = await seedWorkspace();
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId: a.workspaceId,
        kind: 's3',
        name: 's3a',
        endpoint: 's3://cairn-test-bucket',
        options: {},
        enabled: true,
      })
      .returning();
    await db.transaction(async (tx) => {
      await tx.insert(schema.auditLog).values([
        {
          workspaceId: a.workspaceId,
          actorUserId: a.userId,
          action: 'a-only',
          targetType: null,
          targetId: null,
          metadata: {},
          createdAt: new Date('2026-05-26T10:00:00Z'),
        },
        {
          workspaceId: b.workspaceId,
          actorUserId: b.userId,
          action: 'b-only',
          targetType: null,
          targetId: null,
          metadata: {},
          createdAt: new Date('2026-05-26T10:00:00Z'),
        },
      ]);
    });
    const result = await archiveDayToS3({
      workspaceId: a.workspaceId,
      forwarderId: forwarder?.id ?? '',
      date: new Date('2026-05-26T00:00:00Z'),
      db,
      s3Client: stubClient,
    });
    expect(result.rowCount).toBe(1);
    const cmd = sendMock.mock.calls[0]?.[0] as { input: { Body: Buffer } };
    const decompressed = gunzipSync(cmd.input.Body).toString('utf8');
    expect(decompressed).toContain('a-only');
    expect(decompressed).not.toContain('b-only');
  });

  it('returns rowCount=0 + skips upload when the day is empty', async () => {
    const { workspaceId } = await seedWorkspace();
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 's3',
        name: 's3a',
        endpoint: 's3://cairn-test-bucket',
        options: {},
        enabled: true,
      })
      .returning();
    const result = await archiveDayToS3({
      workspaceId,
      forwarderId: forwarder?.id ?? '',
      date: new Date('2026-05-26T00:00:00Z'),
      db,
      s3Client: stubClient,
    });
    expect(result.rowCount).toBe(0);
    expect(result.key).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects when the forwarder kind is not s3', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    void userId;
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 'http',
        name: 'wrong',
        endpoint: 'https://example.invalid',
        options: {},
        enabled: true,
      })
      .returning();
    await expect(
      archiveDayToS3({
        workspaceId,
        forwarderId: forwarder?.id ?? '',
        date: new Date('2026-05-26T00:00:00Z'),
        db,
        s3Client: stubClient,
      }),
    ).rejects.toThrow(/expected s3 forwarder/);
  });
});
