import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { disengageMaintenance, engageMaintenance, getMaintenance } from './maintenance';

/**
 * v0.10.0 C1/C2 — in-process registry for backup ("create snapshot now") and
 * restore jobs.
 *
 * Both job kinds spawn the same compiled CLI bundle the cron scheduler uses
 * (`node dist/server/cli.js backup|restore …`, see src/server/cli.ts) and
 * track its exit in a module-level Map keyed by a random job id.
 *
 * The registry is PER-PROCESS: honest for the documented single-replica
 * deployment, but operators running multiple app replicas will only see a job
 * on the replica that started it (another replica answers the status poll
 * with 404). Known limitation — C3 adds a durable DB-backed job history.
 */

export type BackupJobStatus = 'running' | 'done' | 'failed';

export type BackupJobKind = 'backup' | 'restore' | 'selective-restore';

/** v0.10.0 C4 — completion summary of a selective restore job. */
export type SelectiveRestoreJobResult = {
  pagesRestored: number;
  rowsRestored: number;
  skippedFiles: number;
};

export type BackupJob = {
  id: string;
  kind: BackupJobKind;
  status: BackupJobStatus;
  startedAt: string;
  finishedAt?: string;
  /** Failure detail: exit code + a tail of the CLI's stderr. */
  error?: string;
  /** v0.10.0 C4 — present on done selective-restore jobs. */
  result?: SelectiveRestoreJobResult;
};

export type StartBackupJobResult =
  | { ok: true; job: BackupJob }
  | { ok: false; error: 'pg_dump-not-found' };

export type StartRestoreJobResult =
  | { ok: true; job: BackupJob }
  | {
      ok: false;
      error: 'bundle-missing' | 'encrypted-passphrase-missing' | 'maintenance-active';
    };

const jobs = new Map<string, BackupJob>();

/** Keep only the last 2 KB of stderr — enough to name the failing step. */
const STDERR_TAIL_BYTES = 2_048;

/**
 * Resolve the compiled CLI bundle. In the Docker image (and `pnpm start`)
 * cwd is the app root where `pnpm build:entrypoint` lands `dist/`. But when
 * the standalone server is launched with cwd INSIDE `.next/standalone` (the
 * CI e2e harness does this), `dist/` lives two levels up — probe both
 * candidates instead of trusting cwd (the scheduler's cwd-only resolution
 * never hits this because cron runs in the image, but these routes must work
 * under the e2e harness too).
 */
function resolveCliPath(): string {
  const fromCwd = path.resolve(process.cwd(), 'dist/server/cli.js');
  const fromStandalone = path.resolve(process.cwd(), '../../dist/server/cli.js');
  return existsSync(fromCwd) ? fromCwd : fromStandalone;
}

/**
 * Spawn `node <cliPath> <args>` and track its lifecycle in the registry.
 * `onSettled` runs exactly once when the job leaves 'running' (whichever of
 * the 'error' / 'close' paths fires first) — restore uses it to disengage
 * maintenance mode.
 */
function trackCliJob(opts: {
  kind: BackupJobKind;
  cliPath: string;
  args: string[];
  onSettled?: () => void;
}): BackupJob {
  const job: BackupJob = {
    id: randomUUID(),
    kind: opts.kind,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);

  let settled = false;
  function settle(status: 'done' | 'failed', error?: string): void {
    if (settled) return;
    settled = true;
    job.status = status;
    if (error !== undefined) job.error = error;
    job.finishedAt = new Date().toISOString();
    opts.onSettled?.();
  }

  const child = spawn(process.execPath, [opts.cliPath, ...opts.args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderrTail = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
  });
  child.on('error', (err) => {
    settle('failed', err.message);
  });
  child.on('close', (code) => {
    if (code === 0) {
      settle('done');
    } else {
      settle(
        'failed',
        `${opts.kind} CLI exited with code ${code}${
          stderrTail.trim() ? `: ${stderrTail.trim()}` : ''
        }`,
      );
    }
  });

  return job;
}

export function startBackupJob(opts: {
  /** Bundle output directory (CAIRN_BACKUP_DIR). */
  dir: string;
  /** Override the compiled CLI path (tests pin a stub script). */
  cliPath?: string;
  /** Override the probed dump binary name (tests pass a bogus name / `node`). */
  pgDumpBinary?: string;
}): StartBackupJobResult {
  // Probe pg_dump BEFORE spawning: a missing client binary is an operator
  // setup problem the route should surface as a friendly 503, not a job that
  // starts and immediately fails with an opaque exit code.
  const probe = spawnSync(opts.pgDumpBinary ?? 'pg_dump', ['--version'], { stdio: 'ignore' });
  if (probe.error) {
    return { ok: false, error: 'pg_dump-not-found' };
  }

  const job = trackCliJob({
    kind: 'backup',
    cliPath: opts.cliPath ?? resolveCliPath(),
    args: ['backup', '--out', opts.dir],
  });
  return { ok: true, job };
}

/**
 * v0.10.0 C2 — destructive restore. Engages maintenance (read-only) mode
 * BEFORE spawning `node dist/server/cli.js restore --in <bundle> --force` and
 * disengages it when the CLI settles (success, failure, or spawn error), so
 * the proxy's write gate (src/proxy.ts) covers the whole pg_restore window.
 * `--force` skips the CLI's interactive confirm — the retype gate lives in
 * the restore route instead.
 */
export function startRestoreJob(opts: {
  /** Bundle directory (CAIRN_BACKUP_DIR). */
  dir: string;
  /** Bundle timestamp slug, e.g. `2026-06-10T12-00-00-000Z`. */
  ts: string;
  /** Override the compiled CLI path (tests pin a stub script). */
  cliPath?: string;
}): StartRestoreJobResult {
  // One restore at a time: an active flag means another restore is mid-flight
  // (only restores engage maintenance), so starting a second would interleave
  // two pg_restore runs against the same database.
  if (getMaintenance().active) {
    return { ok: false, error: 'maintenance-active' };
  }

  const plainPath = path.join(opts.dir, `cairn-backup-${opts.ts}.dump`);
  const encPath = `${plainPath}.enc`;
  const bundlePath = existsSync(plainPath) ? plainPath : existsSync(encPath) ? encPath : null;
  if (!bundlePath) {
    return { ok: false, error: 'bundle-missing' };
  }

  // Same failure class as cli.ts restore() raises mid-run — but checked
  // BEFORE spawning, so the admin gets an upfront, friendly error instead of
  // a job that dies immediately.
  if (bundlePath.endsWith('.enc') && !process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE) {
    return { ok: false, error: 'encrypted-passphrase-missing' };
  }

  engageMaintenance();
  try {
    const job = trackCliJob({
      kind: 'restore',
      cliPath: opts.cliPath ?? resolveCliPath(),
      args: ['restore', '--in', bundlePath, '--force'],
      onSettled: disengageMaintenance,
    });
    return { ok: true, job };
  } catch (err) {
    // spawn() itself threw synchronously (it normally reports failures via
    // the 'error' event): never leave the instance stuck read-only.
    disengageMaintenance();
    throw err;
  }
}

/**
 * v0.10.0 C4 — track an in-process async job (no CLI spawn). Used by the
 * selective restore, whose work is a TypeScript pipeline (pg_restore into a
 * scratch DB + remap + insert) rather than a `dist/server/cli.js` subcommand.
 * The runner's resolved value becomes `job.result`; a rejection marks the job
 * failed with the error message. Same per-process registry + caveats as the
 * CLI-backed jobs above.
 */
export function trackAsyncJob(opts: {
  kind: BackupJobKind;
  run: () => Promise<SelectiveRestoreJobResult>;
}): BackupJob {
  const job: BackupJob = {
    id: randomUUID(),
    kind: opts.kind,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);

  void opts.run().then(
    (result) => {
      job.status = 'done';
      job.result = result;
      job.finishedAt = new Date().toISOString();
    },
    (err: unknown) => {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = new Date().toISOString();
    },
  );

  return job;
}

export function getBackupJob(id: string): BackupJob | undefined {
  return jobs.get(id);
}
