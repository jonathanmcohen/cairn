import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  auditUpgradeApplied,
  auditUpgradeFailed,
  auditUpgradeRolledBack,
} from '@/lib/upgrade/audit';
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

describe('upgrade audit hooks', () => {
  it('records upgrade.applied with from/to/migrationCount', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client, { schema });
    try {
      await auditUpgradeApplied({
        workspaceId,
        fromVersion: '0.8.0',
        toVersion: '0.9.0',
        migrationCount: 15,
        db,
      });
      const rows = (await db.execute(
        sql`SELECT action, metadata FROM audit_log WHERE action = 'upgrade.applied' ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as Array<{
        action: string;
        metadata: { fromVersion: string; toVersion: string; migrationCount: number };
      }>;
      expect(rows[0]?.action).toBe('upgrade.applied');
      expect(rows[0]?.metadata.fromVersion).toBe('0.8.0');
      expect(rows[0]?.metadata.toVersion).toBe('0.9.0');
      expect(rows[0]?.metadata.migrationCount).toBe(15);
    } finally {
      await client.end();
    }
  });

  it('records upgrade.failed with error string', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client, { schema });
    try {
      await auditUpgradeFailed({
        workspaceId,
        fromVersion: '0.8.0',
        toVersion: '0.9.0',
        error: 'migration 0042 failed',
        db,
      });
      const rows = (await db.execute(
        sql`SELECT metadata FROM audit_log WHERE action = 'upgrade.failed' ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as Array<{ metadata: { error: string } }>;
      expect(rows[0]?.metadata.error).toBe('migration 0042 failed');
    } finally {
      await client.end();
    }
  });

  it('records upgrade.rolled_back with snapshot path', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client, { schema });
    try {
      await auditUpgradeRolledBack({
        workspaceId,
        snapshotPath: '/data/backups/pre-upgrade-2026-05-26.sql.gz',
        db,
      });
      const rows = (await db.execute(
        sql`SELECT metadata FROM audit_log WHERE action = 'upgrade.rolled_back' ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as Array<{ metadata: { snapshotPath: string } }>;
      expect(rows[0]?.metadata.snapshotPath).toMatch(/pre-upgrade-2026-05-26\.sql\.gz$/);
    } finally {
      await client.end();
    }
  });
});
