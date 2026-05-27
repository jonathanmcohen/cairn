import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { applyUpgrade } from '@/lib/upgrade/apply';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let connectionString = '';
let workspaceId = '';

beforeAll(async () => {
  connectionString = await startPostgres();
  await runMigrations(connectionString);
});

afterAll(async () => {
  await stopPostgres();
});

beforeEach(async () => {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    await db.execute(sql`TRUNCATE TABLE audit_log RESTART IDENTITY CASCADE`);
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    workspaceId = ws.workspaceId;
  } finally {
    await client.end();
  }
});

describe('applyUpgrade', () => {
  it('snapshots, migrates, then emits upgrade.applied (happy path)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-apply-'));
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client, { schema });
    try {
      const result = await applyUpgrade({
        databaseUrl: connectionString,
        backupDir: dir,
        fromVersion: '0.8.0',
        toVersion: '0.9.0',
        workspaceId,
        healthcheck: async () => ({ ok: true, version: '0.9.0' }),
        restartServer: async () => {},
        runMigrations: async () => {},
        db,
      });
      expect(result.ok).toBe(true);
      expect(result.snapshotPath).toMatch(/pre-upgrade-/);

      const audit = (await db.execute(
        sql`SELECT action FROM audit_log WHERE action = 'upgrade.applied' ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as Array<{ action: string }>;
      expect(audit[0]?.action).toBe('upgrade.applied');
    } finally {
      await client.end();
    }
  });

  it('rolls back on migrate failure and emits upgrade.failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-apply-'));
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client, { schema });
    try {
      const result = await applyUpgrade({
        databaseUrl: connectionString,
        backupDir: dir,
        fromVersion: '0.8.0',
        toVersion: '0.9.0',
        workspaceId,
        healthcheck: async () => ({ ok: true, version: '0.9.0' }),
        restartServer: async () => {},
        runMigrations: async () => {
          throw new Error('simulated migration failure');
        },
        db,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('simulated migration failure');

      const audit = (await db.execute(
        sql`SELECT action FROM audit_log WHERE action = 'upgrade.failed' ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as Array<{ action: string }>;
      expect(audit[0]?.action).toBe('upgrade.failed');
    } finally {
      await client.end();
    }
  });

  it('rolls back when healthcheck stays unhealthy after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-apply-'));
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client, { schema });
    try {
      const result = await applyUpgrade({
        databaseUrl: connectionString,
        backupDir: dir,
        fromVersion: '0.8.0',
        toVersion: '0.9.0',
        workspaceId,
        healthcheck: async () => ({ ok: false, version: '0.9.0' }),
        restartServer: async () => {},
        runMigrations: async () => {},
        healthcheckTimeoutMs: 100,
        db,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/health/i);
    } finally {
      await client.end();
    }
  });
});
