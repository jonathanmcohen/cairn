import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * v0.10.0 C1 — in-process registry for "create snapshot now" backup jobs.
 *
 * startBackupJob spawns the same compiled CLI bundle the cron scheduler uses
 * (`node dist/server/cli.js backup --out <dir>`, see src/server/scheduler.ts)
 * and tracks its exit in a module-level Map keyed by a random job id.
 *
 * The registry is PER-PROCESS: honest for the documented single-replica
 * deployment, but operators running multiple app replicas will only see a job
 * on the replica that started it (another replica answers the status poll
 * with 404). Known limitation — C3 adds a durable DB-backed job history.
 */

export type BackupJobStatus = 'running' | 'done' | 'failed';

export type BackupJob = {
  id: string;
  status: BackupJobStatus;
  startedAt: string;
  finishedAt?: string;
  /** Failure detail: exit code + a tail of the CLI's stderr. */
  error?: string;
};

export type StartBackupJobResult =
  | { ok: true; job: BackupJob }
  | { ok: false; error: 'pg_dump-not-found' };

const jobs = new Map<string, BackupJob>();

/** Keep only the last 2 KB of stderr — enough to name the failing step. */
const STDERR_TAIL_BYTES = 2_048;

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

  // Same resolution as the cron scheduler (src/server/scheduler.ts): the app
  // runs from the repo/image root, where `pnpm build:entrypoint` lands the CLI.
  const cliPath = opts.cliPath ?? path.resolve(process.cwd(), 'dist/server/cli.js');

  const job: BackupJob = {
    id: randomUUID(),
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);

  const child = spawn(process.execPath, [cliPath, 'backup', '--out', opts.dir], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderrTail = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
  });
  child.on('error', (err) => {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
  });
  child.on('close', (code) => {
    if (job.status !== 'running') return; // 'error' already settled it
    if (code === 0) {
      job.status = 'done';
    } else {
      job.status = 'failed';
      job.error = `backup CLI exited with code ${code}${
        stderrTail.trim() ? `: ${stderrTail.trim()}` : ''
      }`;
    }
    job.finishedAt = new Date().toISOString();
  });

  return { ok: true, job };
}

export function getBackupJob(id: string): BackupJob | undefined {
  return jobs.get(id);
}
