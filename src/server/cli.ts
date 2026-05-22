// Requires `pg_dump`/`pg_restore` from the postgresql-client package, matching the
// server's MAJOR version (Postgres 16). The runner image installs `postgresql-client-16`;
// a client older than the server cannot restore a 16 custom-format dump. Pin the apt
// package in the Dockerfile runner stage and keep it in lockstep with the Postgres image.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CliArgs, type DbConnection, parseArgs, parseDbUrl } from './cli-internal.js';

const VERSION = process.env.npm_package_version ?? 'unknown';
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/data/uploads';
const FILE_BACKEND = process.env.FILE_BACKEND ?? 'local';

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function backup(conn: DbConnection, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const ts = stamp();
  const dumpPath = join(outDir, `cairn-backup-${ts}.dump`);

  console.log(`Dumping database ${conn.database} → ${dumpPath}`);
  await run(
    'pg_dump',
    [
      '--format=custom',
      '-h',
      conn.host,
      '-p',
      String(conn.port),
      '-U',
      conn.user,
      '-d',
      conn.database,
      '-f',
      dumpPath,
    ],
    { PGPASSWORD: conn.password },
  );

  if (FILE_BACKEND === 's3') {
    console.log(
      'FILE_BACKEND=s3: skipping uploads tar. S3/MinIO buckets must be backed up out-of-band.',
    );
  } else {
    const tarPath = join(outDir, `cairn-uploads-${ts}.tar.gz`);
    console.log(`Archiving uploads ${UPLOAD_DIR} → ${tarPath}`);
    await run('tar', ['-czf', tarPath, '-C', UPLOAD_DIR, '.']);
  }

  const manifest = join(outDir, `cairn-backup-${ts}.manifest.json`);
  await writeFile(
    manifest,
    JSON.stringify(
      {
        version: VERSION,
        createdAt: new Date().toISOString(),
        fileBackend: FILE_BACKEND,
        database: conn.database,
      },
      null,
      2,
    ),
  );
  console.log(`Backup complete. Bundle timestamp: ${ts}`);
  console.warn(
    'WARNING: this bundle contains the full database (password & API-key hashes) and all files. Store it securely.',
  );
}

async function restore(_conn: DbConnection, _bundle: string, _force: boolean): Promise<void> {
  throw new Error('not implemented');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(
      `${(err as Error).message}\n\nUsage:\n  cli backup --out <dir>\n  cli restore --in <bundle> [--force]`,
    );
    process.exit(2);
  }
  const conn = parseDbUrl(url);
  if (args.command === 'backup') {
    await backup(conn, args.out!);
  } else {
    await restore(conn, args.in!, args.force);
  }
}

main().catch((err) => {
  console.error('CLI failed:', err);
  process.exit(1);
});
