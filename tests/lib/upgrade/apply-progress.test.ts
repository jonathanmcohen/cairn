/**
 * v0.9.0 G8 P42 — `applyUpgrade` accepts an `onProgress` callback that
 * emits stage events as the orchestrator advances. The admin SSE route
 * (`/api/admin/upgrade/apply`) pushes these onto a ReadableStream so the
 * admin sees real-time progress during an upgrade.
 *
 * Backwards-compatible: every existing caller passes no callback and the
 * behavior is unchanged.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { applyUpgrade, type ProgressEvent } from '@/lib/upgrade/apply';
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

describe('applyUpgrade onProgress', () => {
  it('emits stage events in order on happy path', async () => {
    const events: ProgressEvent[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'cairn-progress-'));
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
        dumpDatabase: async ({ outDir }) => ({
          path: `${outDir}/fake-dump.sql.gz`,
          bytesWritten: 0,
        }),
        restoreDatabase: async () => {},
        onProgress: (e) => events.push(e),
        db,
      });
      expect(result.ok).toBe(true);
      const stages = events.map((e) => e.stage);
      expect(stages[0]).toBe('snapshot');
      expect(stages).toContain('migrate');
      expect(stages).toContain('restart');
      expect(stages).toContain('healthcheck');
      expect(stages[stages.length - 1]).toBe('done');
    } finally {
      await client.end();
    }
  });

  it('emits failure + rollback events when migrate throws', async () => {
    const events: ProgressEvent[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'cairn-progress-'));
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
          throw new Error('boom');
        },
        dumpDatabase: async ({ outDir }) => ({
          path: `${outDir}/fake-dump.sql.gz`,
          bytesWritten: 0,
        }),
        restoreDatabase: async () => {},
        onProgress: (e) => events.push(e),
        db,
      });
      expect(result.ok).toBe(false);
      expect(events.some((e) => e.stage === 'rollback')).toBe(true);
      expect(events.some((e) => e.stage === 'failed' && (e.message ?? '').includes('boom'))).toBe(
        true,
      );
    } finally {
      await client.end();
    }
  });

  it('runs without onProgress (backwards compatible)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-progress-'));
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
        dumpDatabase: async ({ outDir }) => ({
          path: `${outDir}/fake-dump.sql.gz`,
          bytesWritten: 0,
        }),
        restoreDatabase: async () => {},
        db,
      });
      expect(result.ok).toBe(true);
    } finally {
      await client.end();
    }
  });
});
