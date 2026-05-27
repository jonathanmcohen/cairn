import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import {
  auditUpgradeApplied,
  auditUpgradeFailed,
  auditUpgradeRolledBack,
} from './audit.js';
import { compareJournalToDb, loadBundledJournal } from './migrations.js';
import { dumpDatabase, restoreDatabase } from './snapshot.js';

// biome-ignore lint/suspicious/noExplicitAny: schema-agnostic handle; audit helper only needs raw SQL.
type Db = PostgresJsDatabase<any>;

export type ApplyInput = {
  databaseUrl: string;
  backupDir: string;
  fromVersion: string;
  toVersion: string;
  /** Workspace under which the audit row is recorded (NOT NULL constraint). */
  workspaceId: string;
  /** Pluggable health probe — defaults to fetching /api/health. */
  healthcheck?: () => Promise<{ ok: boolean; version: string }>;
  /** Pluggable restart — defaults to SIGTERM via PID file. */
  restartServer?: () => Promise<void>;
  /** Pluggable migrator — defaults to Drizzle migrate. */
  runMigrations?: () => Promise<void>;
  /** Audit DB handle override (tests). */
  db?: Db;
  healthcheckTimeoutMs?: number;
};

export type ApplyResult = {
  ok: boolean;
  snapshotPath?: string;
  migrationCount?: number;
  error?: string;
};

/**
 * Full apply orchestration:
 *
 *   snapshot -> migrate -> restart -> health -> auto-rollback on failure
 *
 * Every failure path attempts to restore the snapshot and emit
 * `upgrade.failed` (plus `upgrade.rolled_back` if restore succeeded).
 * Success emits `upgrade.applied`. Each step is idempotent and safe to
 * re-run after a rollback.
 */
export async function applyUpgrade(input: ApplyInput): Promise<ApplyResult> {
  const healthcheck = input.healthcheck ?? defaultHealthcheck;
  const restartServer = input.restartServer ?? defaultRestart;
  const runMigrations =
    input.runMigrations ??
    (async () => {
      const client = postgres(input.databaseUrl, { max: 1 });
      try {
        const db = drizzle(client);
        await migrate(db, { migrationsFolder: 'drizzle/migrations' });
      } finally {
        await client.end();
      }
    });
  const timeout = input.healthcheckTimeoutMs ?? 60_000;

  // Step 1: snapshot
  let snapshotPath: string | undefined;
  try {
    const snap = await dumpDatabase({ databaseUrl: input.databaseUrl, outDir: input.backupDir });
    snapshotPath = snap.path;
  } catch (err) {
    const reason = `snapshot: ${(err as Error).message}`;
    await auditUpgradeFailed({
      workspaceId: input.workspaceId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      error: reason,
      db: input.db,
      databaseUrl: input.databaseUrl,
    });
    return { ok: false, error: reason };
  }

  // Step 2: count pending + migrate
  let migrationCount = 0;
  try {
    const journal = await loadBundledJournal();
    const client = postgres(input.databaseUrl, { max: 1 });
    try {
      const cmp = await compareJournalToDb({ journal, db: drizzle(client) });
      migrationCount = cmp.pending.length;
    } finally {
      await client.end();
    }
    await runMigrations();
  } catch (err) {
    return rollback(input, snapshotPath, `migrate: ${(err as Error).message}`);
  }

  // Step 3: restart
  try {
    await restartServer();
  } catch (err) {
    return rollback(input, snapshotPath, `restart: ${(err as Error).message}`);
  }

  // Step 4: poll healthcheck
  const deadline = Date.now() + timeout;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const h = await healthcheck();
      if (h.ok) {
        healthy = true;
        break;
      }
    } catch {
      // tolerate transient errors during restart
    }
    await sleep(250);
  }
  if (!healthy) return rollback(input, snapshotPath, 'healthcheck timeout');

  await auditUpgradeApplied({
    workspaceId: input.workspaceId,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    migrationCount,
    db: input.db,
    databaseUrl: input.databaseUrl,
  });
  return { ok: true, snapshotPath, migrationCount };
}

async function rollback(
  input: ApplyInput,
  snapshotPath: string | undefined,
  reasonIn: string,
): Promise<ApplyResult> {
  let reason = reasonIn;
  if (snapshotPath) {
    try {
      await restoreDatabase({ databaseUrl: input.databaseUrl, dumpPath: snapshotPath });
      await auditUpgradeRolledBack({
        workspaceId: input.workspaceId,
        snapshotPath,
        db: input.db,
        databaseUrl: input.databaseUrl,
      });
    } catch (err) {
      reason = `${reason}; rollback also failed: ${(err as Error).message}`;
    }
  }
  await auditUpgradeFailed({
    workspaceId: input.workspaceId,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    error: reason,
    db: input.db,
    databaseUrl: input.databaseUrl,
  });
  return { ok: false, snapshotPath, error: reason };
}

async function defaultHealthcheck(): Promise<{ ok: boolean; version: string }> {
  const url = `${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/api/health`;
  const r = await fetch(url);
  if (!r.ok) return { ok: false, version: '' };
  const body = (await r.json()) as { version: string };
  return { ok: true, version: body.version };
}

async function defaultRestart(): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  const pidPath = process.env.CAIRN_PID_FILE ?? '/data/cairn.pid';
  const pid = Number((await readFile(pidPath, 'utf8')).trim());
  if (!Number.isFinite(pid)) throw new Error(`invalid pid file ${pidPath}`);
  process.kill(pid, 'SIGTERM');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
