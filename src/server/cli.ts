// Requires `pg_dump`/`pg_restore` from the postgresql-client package, matching the
// server's MAJOR version (Postgres 16). The runner image installs `postgresql-client-16`;
// a client older than the server cannot restore a 16 custom-format dump. Pin the apt
// package in the Dockerfile runner stage and keep it in lockstep with the Postgres image.
import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
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

async function confirmDestructive(database: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nThis will OVERWRITE the database "${database}" and its uploads. This cannot be undone.\nType the database name to confirm: `,
  );
  rl.close();
  return answer.trim() === database;
}

async function restore(conn: DbConnection, bundle: string, force: boolean): Promise<void> {
  if (!force) {
    // Never proceed implicitly: a non-interactive stdin (e.g. piped/cron) cannot answer
    // the confirmation prompt, so refuse outright rather than hang or silently no-op.
    if (!process.stdin.isTTY) {
      console.error(
        'Refusing to run a destructive restore non-interactively without --force. ' +
          'Re-run with --force, or attach an interactive terminal to confirm.',
      );
      process.exit(3);
    }
    const ok = await confirmDestructive(conn.database);
    if (!ok) {
      console.error(
        'Confirmation did not match. Aborting (no changes made). Use --force to skip this prompt.',
      );
      process.exit(3);
    }
  }

  console.log(`Restoring database ${conn.database} from ${bundle}`);
  await run(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '-h',
      conn.host,
      '-p',
      String(conn.port),
      '-U',
      conn.user,
      '-d',
      conn.database,
      bundle,
    ],
    { PGPASSWORD: conn.password },
  );

  if (FILE_BACKEND === 's3') {
    console.log('FILE_BACKEND=s3: uploads live in the bucket; restore them out-of-band.');
  } else {
    // Bundle name: cairn-backup-<ts>.dump → matching cairn-uploads-<ts>.tar.gz in the same dir.
    const ts = basename(bundle)
      .replace(/^cairn-backup-/, '')
      .replace(/\.dump$/, '');
    const dir = dirname(bundle);
    const tar = (await readdir(dir)).find((f) => f === `cairn-uploads-${ts}.tar.gz`);
    if (tar) {
      console.log(`Restoring uploads from ${tar} → ${UPLOAD_DIR}`);
      await mkdir(UPLOAD_DIR, { recursive: true });
      await run('tar', ['-xzf', join(dir, tar), '-C', UPLOAD_DIR]);
    } else {
      console.warn(
        `No matching uploads archive (cairn-uploads-${ts}.tar.gz) found; restored DB only.`,
      );
    }
  }
  console.log('Restore complete.');
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
