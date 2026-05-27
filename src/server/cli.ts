// Requires `pg_dump`/`pg_restore` from the postgresql-client package, matching the
// server's MAJOR version (Postgres 16). The runner image installs `postgresql-client-16`;
// a client older than the server cannot restore a 16 custom-format dump. Pin the apt
// package in the Dockerfile runner stage and keep it in lockstep with the Postgres image.
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { type CliArgs, type DbConnection, parseArgs, parseDbUrl } from './cli-internal.js';

const VERSION = process.env.npm_package_version ?? 'unknown';
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/data/uploads';
const FILE_BACKEND = process.env.FILE_BACKEND ?? 'local';

// `env` is extra vars merged onto process.env (see spawn below). Typed as a plain
// string map rather than NodeJS.ProcessEnv: under the entrypoint tsconfig, Next's
// ambient augmentation makes ProcessEnv require NODE_ENV, which would reject a bare
// `{ PGPASSWORD }` literal here.
function run(cmd: string, args: string[], env?: Record<string, string>): Promise<void> {
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

async function backup(conn: DbConnection, outDir: string): Promise<string> {
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
  return ts;
}

/** Delete cairn-backup-* / cairn-uploads-* / manifest bundles older than N days in outDir. */
async function pruneBundles(outDir: string, retentionDays: number): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of await readdir(outDir)) {
    if (!/^cairn-(backup|uploads)-/.test(name)) continue;
    const full = join(outDir, name);
    const st = await stat(full);
    if (st.mtimeMs < cutoff) {
      console.log(`Pruning expired bundle ${name}`);
      await rm(full, { force: true });
    }
  }
}

/** Push every file produced by this backup run into the configured FileStorage. */
async function pushToTarget(outDir: string, ts: string): Promise<void> {
  // Dynamic import — bundled into the entrypoint output, NOT a top-level @/ alias.
  const { getStorage } = await import('../lib/files/get-storage.js');
  const storage = getStorage();
  for (const name of await readdir(outDir)) {
    if (!name.includes(ts)) continue;
    const body = await readFile(join(outDir, name));
    await storage.put(`backups/${name}`, body, 'application/octet-stream');
    console.log(`Uploaded ${name} → FileStorage backups/${name}`);
  }
}

/**
 * Best-effort CLI audit. The backup/export/import path MUST NOT fail because
 * audit write failed — wrap and log only. The full DB-backed audit-row insert
 * lands when the entrypoint exposes the audit helper via the dynamic-import
 * seam; for now this is a structured stdout entry that ops can grep.
 */
async function recordCliAudit(
  _conn: DbConnection,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    console.log(`[audit] ${action} ${JSON.stringify(metadata)}`);
  } catch (err) {
    console.error('[audit] failed to record cli audit', err);
  }
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
      `${(err as Error).message}\n\nUsage:\n` +
        `  cli backup --out <dir> [--retention-days N] [--target local|s3]\n` +
        `  cli restore (--in <bundle> | --from-s3 <key>) [--force]\n` +
        `  cli export --workspace <id> --out <dir>\n` +
        `  cli import --source notion|markdown-folder|workspace-archive --file <path> --workspace <id>\n` +
        `  cli reconcile [--workspace <id>]\n` +
        `  cli reminders:scan\n` +
        `  cli reindex-embeddings [--workspace <id>] [--batch-size N]\n` +
        `  cli connector:sync [--connector <id>]\n` +
        `  cli trash:purge --workspace-id=<id>\n` +
        `  cli pages:auto-unlock\n` +
        `  cli flashcards:notify-due\n` +
        `  cli siem:retry-sweep\n` +
        `  cli siem:daily-archive`,
    );
    process.exit(2);
  }
  const conn = parseDbUrl(url);

  if (args.command === 'backup') {
    if (!args.out) throw new Error('--out is required for backup');
    const ts = await backup(conn, args.out);
    if (args.target === 's3') await pushToTarget(args.out, ts);
    if (args.retentionDays !== undefined) await pruneBundles(args.out, args.retentionDays);
    await recordCliAudit(conn, 'backup.created', {
      target: args.target,
      retentionDays: args.retentionDays,
    });
  } else if (args.command === 'restore') {
    let localBundlePath: string;
    if (args.fromS3) {
      const { getStorage } = await import('../lib/files/get-storage.js');
      const { mkdtemp, writeFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const storage = getStorage();
      const tmpDir = await mkdtemp(path.join(tmpdir(), 'cairn-restore-'));
      localBundlePath = path.join(tmpDir, basename(args.fromS3));
      const readable = storage.read(args.fromS3);
      const chunks: Buffer[] = [];
      for await (const chunk of readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      await writeFile(localBundlePath, Buffer.concat(chunks));
      console.log(`Downloaded ${args.fromS3} → ${localBundlePath}`);
    } else {
      if (!args.in) throw new Error('--in is required for restore (or use --from-s3 <key>)');
      localBundlePath = args.in;
    }
    await restore(conn, localBundlePath, args.force);
  } else if (args.command === 'export') {
    if (!args.workspace || !args.out) throw new Error('--workspace + --out required');
    const { runWorkspaceExport } = await import('../lib/export/workspace-archive.js');
    await runWorkspaceExport({ workspaceId: args.workspace, outDir: args.out });
    await recordCliAudit(conn, 'export.created', { workspaceId: args.workspace });
  } else if (args.command === 'import') {
    if (!args.source || !args.file || !args.workspace) {
      throw new Error('--source + --file + --workspace required');
    }
    // Actor user id is provided via env var; the CLI can be run unattended
    // from cron/restore scripts, and the audit row needs an FK target.
    const actorUserId = process.env.CAIRN_CLI_ACTOR_USER_ID;
    if (!actorUserId) {
      throw new Error('CAIRN_CLI_ACTOR_USER_ID env var is required for cli import');
    }
    const { runImport } = await import('../lib/import/run.js');
    const report = await runImport({
      source: args.source,
      file: args.file,
      workspaceId: args.workspace,
      actorUserId,
    });
    console.log(JSON.stringify(report, null, 2));
    await recordCliAudit(conn, 'import.completed', { source: args.source, ...report.counts });
  } else if (args.command === 'reconcile') {
    const { reconcileAll } = await import('../lib/quotas/reconcile-cli.js');
    const results = await reconcileAll(args.workspace);
    console.log(`Reconciled ${results.length} workspace(s).`);
  } else if (args.command === 'reminders:scan') {
    const { runRemindersScan } = await import('../lib/reminders/reminders-cli.js');
    const { fired } = await runRemindersScan();
    console.log(`reminders:scan fired ${fired} reminder(s)`);
  } else if (args.command === 'reindex-embeddings') {
    const { runReindexEmbeddingsCli } = await import('../lib/search/reindex-cli.js');
    const summary = await runReindexEmbeddingsCli({
      workspaceId: args.workspace,
      batchSize: args.batchSize,
    });
    console.log(JSON.stringify(summary, null, 2));
    await recordCliAudit(conn, 'embedding.backfill_completed', {
      workspaceId: args.workspace,
      ...summary,
    });
  } else if (args.command === 'connector:sync') {
    const { runConnectorSync } = await import('../lib/connectors/cli.js');
    await runConnectorSync({ connectorId: args.connectorId });
    await recordCliAudit(conn, 'connector.sync_invoked', { connectorId: args.connectorId });
  } else if (args.command === 'trash:purge') {
    if (!args.workspaceId) throw new Error('trash:purge requires --workspace-id=<id>');
    const { runTrashPurgeCli } = await import('../lib/trash/cli.js');
    const summary = await runTrashPurgeCli({ workspaceId: args.workspaceId });
    console.log(
      `[trash:purge] ${args.workspaceId} purged=${summary.purgedCount} ` +
        `descendants=${summary.descendantsCount} bytes=${summary.bytesReclaimed}`,
    );
  } else if (args.command === 'pages:auto-unlock') {
    // v0.9.0 G2 P14 — global sweep. Single audit row per affected page;
    // logs the count so the scheduler can surface it in last_status.
    const { runAutoUnlockCli } = await import('../lib/pages/auto-unlock-cli.js');
    const summary = await runAutoUnlockCli();
    console.log(`[pages:auto-unlock] unlocked=${summary.unlockedCount}`);
  } else if (args.command === 'flashcards:notify-due') {
    // v0.9.0 G3 P19 — global daily sweep. Inserts one `flashcards_due`
    // notification per (user, workspace) with at least one due card today.
    const { runFlashcardsNotifyDueCli } = await import('../lib/flashcards/notify-due-cli.js');
    const summary = await runFlashcardsNotifyDueCli();
    console.log(`[flashcards:notify-due] notified=${summary.notified}`);
  } else if (args.command === 'siem:retry-sweep') {
    // v0.9.0 G8 P39 — global every-minute sweep that re-runs retry-status
    // SIEM deliveries whose next_attempt_at has passed.
    const { runSiemRetrySweep } = await import('../lib/siem/retry-cli.js');
    const summary = await runSiemRetrySweep();
    console.log(`[siem:retry-sweep] swept=${summary.swept}`);
  } else if (args.command === 'siem:daily-archive') {
    // v0.9.0 G8 P40 — global daily sweep at 01:15 UTC that archives the prior
    // UTC day of audit_log rows to S3 (gzipped NDJSON) for every enabled
    // `kind='s3'` forwarder. One delivery-log row per non-empty archive.
    const { runSiemDailyArchive } = await import('../lib/siem/archive-cli.js');
    const summary = await runSiemDailyArchive();
    console.log(
      `[siem:daily-archive] swept=${summary.swept} ok=${summary.succeeded} failed=${summary.failed}`,
    );
  }
}

main().catch((err) => {
  console.error('CLI failed:', err);
  process.exit(1);
});
