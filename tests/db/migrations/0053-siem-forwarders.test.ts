import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';

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

describe('migration 0053 — SIEM forwarders', () => {
  it('creates siem_forwarders with the expected columns', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'siem_forwarders' ORDER BY column_name
    `)) as unknown as Array<{ column_name: string }>;
    const cols = rows.map((c) => c.column_name);
    for (const expected of [
      'id',
      'workspace_id',
      'kind',
      'name',
      'endpoint',
      'credential_secret',
      'options',
      'enabled',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(expected);
    }
  });

  it('creates siem_delivery_log with retry + status fields', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'siem_delivery_log' ORDER BY column_name
    `)) as unknown as Array<{ column_name: string }>;
    const cols = rows.map((c) => c.column_name);
    for (const expected of [
      'id',
      'forwarder_id',
      'audit_event_id',
      'status',
      'attempt',
      'error',
      'delivered_at',
      'next_attempt_at',
    ]) {
      expect(cols).toContain(expected);
    }
  });

  it('rejects unknown kind values on siem_forwarders', async () => {
    await db.execute(drizzleSql`
      INSERT INTO workspaces (id, name, slug, created_at)
      VALUES ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaa5301', 'w', 'w-0053-1', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await expect(
      db.execute(drizzleSql`
        INSERT INTO siem_forwarders
          (workspace_id, kind, name, endpoint, options, enabled, created_at, updated_at)
        VALUES
          ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaa5301'::uuid, 'unknown_kind', 'x', 'x',
           '{}'::jsonb, true, now(), now());
      `),
    ).rejects.toThrow();
  });

  it('rejects unknown status values on siem_delivery_log', async () => {
    await db.execute(drizzleSql`
      INSERT INTO workspaces (id, name, slug, created_at)
      VALUES ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaa5302', 'w', 'w-0053-2', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    const installRow = (await db.execute(drizzleSql`
      INSERT INTO siem_forwarders
        (workspace_id, kind, name, endpoint, options, enabled, created_at, updated_at)
      VALUES
        ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaa5302'::uuid, 'http', 'x', 'https://example.invalid',
         '{}'::jsonb, true, now(), now())
      RETURNING id;
    `)) as unknown as Array<{ id: string }>;
    const forwarderId = installRow[0]?.id;
    expect(forwarderId).toBeTruthy();
    const auditRow = (await db.execute(drizzleSql`
      INSERT INTO audit_log (workspace_id, action, metadata)
      VALUES ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaa5302'::uuid, 'test.event', '{}'::jsonb)
      RETURNING id;
    `)) as unknown as Array<{ id: string }>;
    const auditId = auditRow[0]?.id;
    expect(auditId).toBeTruthy();
    await expect(
      db.execute(drizzleSql`
        INSERT INTO siem_delivery_log
          (forwarder_id, audit_event_id, status, attempt, delivered_at)
        VALUES
          (${forwarderId}::uuid, ${auditId}::uuid, 'bad', 1, now());
      `),
    ).rejects.toThrow();
  });

  it('accepts kind=syslog and kind=http', async () => {
    await db.execute(drizzleSql`
      INSERT INTO workspaces (id, name, slug, created_at)
      VALUES ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaa5303', 'w', 'w-0053-3', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.execute(drizzleSql`
      INSERT INTO siem_forwarders
        (workspace_id, kind, name, endpoint, options, enabled, created_at, updated_at)
      VALUES
        ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaa5303'::uuid, 'syslog', 's', 'udp://127.0.0.1:514',
         '{}'::jsonb, true, now(), now()),
        ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaa5303'::uuid, 'http', 'h', 'https://example.invalid',
         '{}'::jsonb, true, now(), now());
    `);
    const rows = (await db.execute(drizzleSql`
      SELECT kind FROM siem_forwarders
      WHERE workspace_id = 'aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaa5303'::uuid
      ORDER BY kind;
    `)) as unknown as Array<{ kind: string }>;
    expect(rows.map((r) => r.kind)).toEqual(['http', 'syslog']);
  });
});
