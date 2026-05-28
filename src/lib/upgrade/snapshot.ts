import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createGunzip, createGzip } from 'node:zlib';

export type DumpResult = { path: string; bytesWritten: number };

/**
 * pg_dump -> gzip -> {outDir}/<label>-<ts>.sql.gz.
 *
 * Uses --clean --if-exists so the resulting script is self-contained: a
 * subsequent `psql --single-transaction < dump.sql` will DROP-then-CREATE
 * every object before recreating data, which is the only sane behaviour for
 * an upgrade rollback. Streams pg_dump's stdout through gzip into the sink
 * so memory stays flat even for multi-GB dumps.
 */
export async function dumpDatabase(input: {
  databaseUrl: string;
  outDir: string;
  label?: string;
}): Promise<DumpResult> {
  await mkdir(input.outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const label = input.label ?? 'pre-upgrade';
  const out = join(input.outDir, `${label}-${ts}.sql.gz`);

  return new Promise<DumpResult>((resolve, reject) => {
    const proc = spawn(
      'pg_dump',
      ['--clean', '--if-exists', '--no-owner', '--no-privileges', input.databaseUrl],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const gz = createGzip();
    const sink = createWriteStream(out);
    let stderr = '';
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const ok = (value: DumpResult): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    proc.stderr.on('data', (d) => {
      stderr += String(d);
    });
    proc.stdout.pipe(gz).pipe(sink);
    sink.on('finish', () => {
      if (proc.exitCode !== 0 && proc.exitCode !== null) {
        fail(new Error(`pg_dump exited ${proc.exitCode}: ${stderr}`));
        return;
      }
      ok({ path: out, bytesWritten: statSync(out).size });
    });
    sink.on('error', fail);
    proc.on('error', fail);
    proc.on('exit', (code) => {
      if (code !== 0) fail(new Error(`pg_dump exited ${code}: ${stderr}`));
    });
  });
}

/**
 * gunzip a dump file and stream it through `psql --single-transaction`. The
 * dump was written with --clean --if-exists, so this restores in-place even
 * if the schema is currently dirty.
 */
export async function restoreDatabase(input: {
  databaseUrl: string;
  dumpPath: string;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const psql = spawn('psql', ['--single-transaction', input.databaseUrl], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    psql.stderr.on('data', (d) => {
      stderr += String(d);
    });
    psql.stdout.on('data', () => {
      // drain stdout; psql echoes table-restore notices
    });
    const src = createReadStream(input.dumpPath).pipe(createGunzip());
    src.pipe(psql.stdin);
    src.on('error', reject);
    psql.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited ${code}: ${stderr}`));
    });
    psql.on('error', reject);
  });
}
