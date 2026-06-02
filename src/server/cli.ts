// Requires `pg_dump`/`pg_restore` from the postgresql-client package, matching the
// server's MAJOR version (Postgres 16). The runner image installs `postgresql-client-16`;
// a client older than the server cannot restore a 16 custom-format dump. Pin the apt
// package in the Dockerfile runner stage and keep it in lockstep with the Postgres image.
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pipeline } from 'node:stream/promises';
import { type CliArgs, type DbConnection, parseArgs, parseDbUrl } from './cli-internal.js';

const VERSION = process.env.npm_package_version ?? 'unknown';
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/data/uploads';
const FILE_BACKEND = process.env.FILE_BACKEND ?? 'local';
const BACKUP_PASSPHRASE = process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE;

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

/**
 * v0.9.0 G8 P43 — wrap a file in the AES-256-GCM envelope when
 * CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is set. The plaintext input is removed on
 * success so the on-disk artefact is only the `.enc` ciphertext. No-op when the
 * env is unset (raw .dump / .tar.gz stays exactly as v0.5 P5 produced it).
 *
 * Returned path is the final on-disk artefact (input path when unencrypted;
 * `${input}.enc` when encrypted). Callers update their bookkeeping (manifest,
 * pushToTarget) against the returned name.
 */
async function encryptInPlaceIfRequested(inputPath: string): Promise<string> {
  if (!BACKUP_PASSPHRASE) return inputPath;
  const { encryptBackup } = await import('../lib/backups/encryption.js');
  const outputPath = `${inputPath}.enc`;
  console.log(`Encrypting ${basename(inputPath)} → ${basename(outputPath)} (AES-256-GCM envelope)`);
  await pipeline(
    createReadStream(inputPath),
    encryptBackup(BACKUP_PASSPHRASE),
    createWriteStream(outputPath),
  );
  await unlink(inputPath);
  return outputPath;
}

/**
 * v0.9.0 G8 P43 — inverse of encryptInPlaceIfRequested. Reads `<bundle>.enc`,
 * decrypts to a sibling `<bundle>` (without `.enc`), and returns the plaintext
 * path. The caller is responsible for cleaning up the plaintext after restore.
 * Throws on wrong passphrase / tamper / wrong magic with the underlying
 * `decryption failed: ...` / `envelope magic mismatch ...` message.
 */
async function decryptToSibling(encPath: string, passphrase: string): Promise<string> {
  const { decryptBackup } = await import('../lib/backups/encryption.js');
  const plainPath = encPath.replace(/\.enc$/, '');
  if (plainPath === encPath) {
    throw new Error(`decrypt path requires a .enc suffix on the input file, got: ${encPath}`);
  }
  console.log(`Decrypting ${basename(encPath)} → ${basename(plainPath)}`);
  await pipeline(
    createReadStream(encPath),
    decryptBackup(passphrase),
    createWriteStream(plainPath),
  );
  return plainPath;
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
  // v0.9.0 G8 P43 — optional AES-256-GCM envelope. No-op when the env is unset.
  await encryptInPlaceIfRequested(dumpPath);

  if (FILE_BACKEND === 's3') {
    console.log(
      'FILE_BACKEND=s3: skipping uploads tar. S3/MinIO buckets must be backed up out-of-band.',
    );
  } else {
    const tarPath = join(outDir, `cairn-uploads-${ts}.tar.gz`);
    console.log(`Archiving uploads ${UPLOAD_DIR} → ${tarPath}`);
    await run('tar', ['-czf', tarPath, '-C', UPLOAD_DIR, '.']);
    await encryptInPlaceIfRequested(tarPath);
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
        // v0.9.0 G8 P43 — operators inspecting the manifest can tell at a glance
        // whether the sibling .dump/.tar.gz files are encrypted, without
        // having to magic-byte the archive bodies themselves.
        encrypted: Boolean(BACKUP_PASSPHRASE),
      },
      null,
      2,
    ),
  );
  console.log(`Backup complete. Bundle timestamp: ${ts}`);
  if (BACKUP_PASSPHRASE) {
    console.warn(
      'NOTE: archives are AES-256-GCM-encrypted (CAIRN-ENC-BAK-v1). KEEP CAIRN_BACKUP_ENCRYPTION_PASSPHRASE — without it the bundle is unrecoverable.',
    );
  } else {
    console.warn(
      'WARNING: this bundle contains the full database (password & API-key hashes) and all files. Store it securely.',
    );
  }
  return ts;
}

/** Delete cairn-backup-* / cairn-uploads-* / manifest bundles older than N days in outDir.
 * Matches both raw `.dump`/`.tar.gz` and `.enc`-encrypted variants (v0.9.0 G8 P43). */
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

  // v0.9.0 G8 P43 — if the bundle is an encrypted envelope, decrypt to a
  // sibling plaintext first. CAIRN_BACKUP_ENCRYPTION_PASSPHRASE MUST be set
  // (matching the passphrase used at backup time). The plaintext sibling lives
  // alongside the .enc input and is removed below after pg_restore completes.
  // A `.dump.enc` becomes `.dump`; a `.tar.gz.enc` becomes `.tar.gz`.
  let pgRestoreInput = bundle;
  let plaintextToCleanUp: string | null = null;
  if (bundle.endsWith('.enc')) {
    if (!BACKUP_PASSPHRASE) {
      throw new Error(
        `restore: bundle ${basename(bundle)} is encrypted (.enc) but CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is unset`,
      );
    }
    pgRestoreInput = await decryptToSibling(bundle, BACKUP_PASSPHRASE);
    plaintextToCleanUp = pgRestoreInput;
  }

  console.log(`Restoring database ${conn.database} from ${pgRestoreInput}`);
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
      pgRestoreInput,
    ],
    { PGPASSWORD: conn.password },
  );

  if (FILE_BACKEND === 's3') {
    console.log('FILE_BACKEND=s3: uploads live in the bucket; restore them out-of-band.');
  } else {
    // Bundle name: cairn-backup-<ts>.dump[.enc] → matching cairn-uploads-<ts>.tar.gz[.enc].
    const ts = basename(pgRestoreInput)
      .replace(/^cairn-backup-/, '')
      .replace(/\.dump$/, '');
    const dir = dirname(bundle);
    const dirEntries = await readdir(dir);
    const rawTar = `cairn-uploads-${ts}.tar.gz`;
    const encTar = `cairn-uploads-${ts}.tar.gz.enc`;
    const tarName = dirEntries.find((f) => f === rawTar) ?? dirEntries.find((f) => f === encTar);
    if (tarName) {
      let tarInputPath = join(dir, tarName);
      let tarPlaintextToCleanUp: string | null = null;
      if (tarName.endsWith('.enc')) {
        if (!BACKUP_PASSPHRASE) {
          throw new Error(
            `restore: uploads archive ${tarName} is encrypted but CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is unset`,
          );
        }
        tarInputPath = await decryptToSibling(tarInputPath, BACKUP_PASSPHRASE);
        tarPlaintextToCleanUp = tarInputPath;
      }
      console.log(`Restoring uploads from ${basename(tarInputPath)} → ${UPLOAD_DIR}`);
      await mkdir(UPLOAD_DIR, { recursive: true });
      await run('tar', ['-xzf', tarInputPath, '-C', UPLOAD_DIR]);
      if (tarPlaintextToCleanUp) {
        await unlink(tarPlaintextToCleanUp);
      }
    } else {
      console.warn(`No matching uploads archive (${rawTar} or ${encTar}) found; restored DB only.`);
    }
  }

  if (plaintextToCleanUp) {
    // v0.9.0 G8 P43 — remove the temporary decrypted dump so the on-disk
    // artefact set stays exactly as it was before the restore command ran.
    await unlink(plaintextToCleanUp);
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
        `  cli pages:purge-orphans [--older-than N] [--dry-run]\n` +
        `  cli flashcards:notify-due\n` +
        `  cli siem:retry-sweep\n` +
        `  cli siem:daily-archive\n` +
        `  cli release-watch:tick`,
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
  } else if (args.command === 'pages:purge-orphans') {
    // v0.9.8 G4 (H) — global sweep that soft-deletes orphan-empty-Untitled
    // pages older than --older-than days (default 30). --dry-run lists only.
    const olderThanDays = args.olderThanDays ?? 30;
    const { runOrphanPurgeCli } = await import('../lib/pages/orphan-purge-cli.js');
    const summary = await runOrphanPurgeCli({ olderThanDays, dryRun: args.dryRun });
    if (args.dryRun) {
      console.log(
        `[pages:purge-orphans] dry-run olderThanDays=${olderThanDays} candidates=${summary.candidates.length}`,
      );
      for (const c of summary.candidates) {
        console.log(`  ${c.pageId} (workspace ${c.workspaceId})`);
      }
    } else {
      console.log(
        `[pages:purge-orphans] olderThanDays=${olderThanDays} purged=${summary.purgedCount}`,
      );
    }
    await recordCliAudit(conn, 'pages.orphans_purged', {
      olderThanDays,
      dryRun: args.dryRun,
      count: args.dryRun ? summary.candidates.length : summary.purgedCount,
    });
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
  } else if (args.command === 'release-watch:tick') {
    // v0.9.0 G8 P42 — daily release-watch tick. Polls the configured
    // GitHub releases feed; if the latest stable tag is newer than the
    // bundled version, inserts one `upgrade_available` notification per
    // (admin/owner, workspace) that hasn't been notified for this exact
    // target version yet. Auto-apply remains OFF — the admin must click
    // the button at /settings/admin/upgrade.
    const { runReleaseWatchTickCli } = await import('../lib/upgrade/release-watch-cli.js');
    const summary = await runReleaseWatchTickCli();
    console.log(
      `[release-watch:tick] created=${summary.notificationsCreated} latestTag=${summary.latestTag ?? 'n/a'}${
        summary.feedError ? ` feedError=${summary.feedError}` : ''
      }`,
    );
  }
}

main().catch((err) => {
  console.error('CLI failed:', err);
  process.exit(1);
});
