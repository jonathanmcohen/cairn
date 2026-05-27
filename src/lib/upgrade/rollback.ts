import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { auditUpgradeRolledBack } from './audit.js';
import { restoreDatabase } from './snapshot.js';

// biome-ignore lint/suspicious/noExplicitAny: schema-agnostic handle.
type Db = PostgresJsDatabase<any>;

export type RollbackInput = {
  databaseUrl: string;
  backupDir: string;
  /** Workspace under which the audit row is recorded. Omit to skip auditing. */
  workspaceId?: string;
  snapshotPath?: string;
  restartServer?: () => Promise<void>;
  db?: Db;
};

export type RollbackResult = {
  ok: boolean;
  snapshotPath: string;
  error?: string;
};

/**
 * Standalone rollback. If `snapshotPath` is omitted, picks the newest
 * `.sql.gz` file in `backupDir`. Restores via psql, optionally restarts
 * the server, and emits `upgrade.rolled_back` if `workspaceId` is set.
 */
export async function rollbackUpgrade(input: RollbackInput): Promise<RollbackResult> {
  const path = input.snapshotPath ?? pickNewestSnapshot(input.backupDir);
  if (!path) {
    return { ok: false, snapshotPath: '', error: `no snapshot found in ${input.backupDir}` };
  }

  try {
    await restoreDatabase({ databaseUrl: input.databaseUrl, dumpPath: path });
  } catch (err) {
    return { ok: false, snapshotPath: path, error: `restore: ${(err as Error).message}` };
  }
  if (input.restartServer) await input.restartServer();
  if (input.workspaceId) {
    await auditUpgradeRolledBack({
      workspaceId: input.workspaceId,
      snapshotPath: path,
      db: input.db,
      databaseUrl: input.databaseUrl,
    });
  }
  return { ok: true, snapshotPath: path };
}

function pickNewestSnapshot(dir: string): string | null {
  let candidates: Array<{ name: string; mtime: number }>;
  try {
    candidates = readdirSync(dir)
      .filter((f) => f.endsWith('.sql.gz'))
      .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return null;
  }
  return candidates[0] ? join(dir, candidates[0].name) : null;
}
