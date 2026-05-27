#!/usr/bin/env node
/**
 * cairn-upgrade -- operator CLI for the v0.9.0 G8 P41 upgrade lifecycle.
 *
 * Bundled to dist/server/upgrade-cli.js via `pnpm build:entrypoint` and
 * also runnable from source via `pnpm exec tsx src/server/upgrade-cli.ts`.
 *
 * Subcommands:
 *   preview                  Dry-run pending migrations against a scratch DB.
 *   apply --confirm          Snapshot -> migrate -> restart -> health.
 *                            Refuses to run without --confirm.
 *   rollback [--snapshot]    Restore from a snapshot (newest auto-picked).
 *   healthcheck              Probe /api/health + journal-vs-db drift.
 *
 * Shared options:
 *   --database-url <url>     Override DATABASE_URL.
 *   --backup-dir <path>      Override CAIRN_BACKUP_DIR (default /data/backups).
 *   --via-compose            Wrap apply with docker compose stop/pull/up.
 *   --workspace-id <uuid>    Audit row workspaceId (required for apply +
 *                            rollback when audit emission is desired).
 *   --from-version <v>       For apply audit metadata (default: package.json).
 *   --to-version <v>         For apply audit metadata (default: package.json).
 *
 * Exits 0 on success, 1 on failure. Output is JSON for machine consumers
 * (P42 admin UI worker), with optional human-readable schema diff appended
 * by `preview`.
 */
import { applyUpgrade } from '../lib/upgrade/apply.js';
import { applyViaCompose } from '../lib/upgrade/compose.js';
import { runHealthcheck } from '../lib/upgrade/healthcheck.js';
import { previewUpgrade } from '../lib/upgrade/preview.js';
import { rollbackUpgrade } from '../lib/upgrade/rollback.js';

type GlobalOpts = {
  databaseUrl: string;
  backupDir: string;
  viaCompose: boolean;
  workspaceId?: string;
  fromVersion: string;
  toVersion: string;
  snapshot?: string;
  confirm: boolean;
};

function parseArgs(argv: string[]): { command: string; opts: GlobalOpts } {
  const args = argv.slice(2);
  const command = args.shift() ?? '';
  const opts: GlobalOpts = {
    databaseUrl: process.env.DATABASE_URL ?? '',
    backupDir: process.env.CAIRN_BACKUP_DIR ?? '/data/backups',
    viaCompose: false,
    fromVersion: process.env.npm_package_version ?? 'unknown',
    toVersion: process.env.npm_package_version ?? 'unknown',
    confirm: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const next = (): string => {
      const v = args[i + 1];
      if (v === undefined) throw new Error(`${a} requires a value`);
      i += 1;
      return v;
    };
    if (a === '--database-url') opts.databaseUrl = next();
    else if (a === '--backup-dir') opts.backupDir = next();
    else if (a === '--via-compose') opts.viaCompose = true;
    else if (a === '--workspace-id') opts.workspaceId = next();
    else if (a === '--from-version') opts.fromVersion = next();
    else if (a === '--to-version') opts.toVersion = next();
    else if (a === '--snapshot') opts.snapshot = next();
    else if (a === '--confirm') opts.confirm = true;
    else if (a === '--help' || a === '-h') {
      // help is rendered at the top of run()
    } else if (a.startsWith('--')) {
      throw new Error(`unknown option: ${a}`);
    }
  }
  return { command, opts };
}

function printHelp(): void {
  // biome-ignore lint/suspicious/noConsole: CLI help output
  console.log(`Usage: cairn-upgrade <command> [options]

Commands:
  preview                Dry-run pending migrations against a scratch DB
  apply --confirm        Apply pending migrations (snapshot -> migrate -> restart -> health)
  rollback               Restore from a snapshot (--snapshot <path> or newest auto-picked)
  healthcheck            Probe /api/health + check journal vs __drizzle_migrations

Options:
  --database-url <url>   Override DATABASE_URL
  --backup-dir <path>    Override CAIRN_BACKUP_DIR (default /data/backups)
  --via-compose          Wrap apply with docker compose stop/pull/up
  --workspace-id <uuid>  Audit row workspaceId (required to emit audit rows)
  --from-version <v>     Apply audit metadata
  --to-version <v>       Apply audit metadata
  --snapshot <path>      rollback: explicit snapshot path
  --confirm              apply: required confirmation flag
  --help, -h             Show this help`);
}

async function run(): Promise<number> {
  const { command, opts } = parseArgs(process.argv);
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return command ? 0 : 1;
  }
  if (!opts.databaseUrl) {
    console.error('DATABASE_URL is required (set env var or pass --database-url)');
    return 1;
  }

  if (command === 'preview') {
    const r = await previewUpgrade({ databaseUrl: opts.databaseUrl });
    // biome-ignore lint/suspicious/noConsole: CLI output for machine + human consumers
    console.log(JSON.stringify({ ok: r.ok, pendingTags: r.pendingTags }, null, 2));
    if (r.schemaDiff) {
      // biome-ignore lint/suspicious/noConsole: human-readable diff after JSON
      console.log(`\n--- schema diff ---\n${r.schemaDiff}`);
    }
    return r.ok ? 0 : 1;
  }

  if (command === 'apply') {
    if (!opts.confirm) {
      console.error('apply refuses to run without --confirm');
      return 1;
    }
    if (!opts.workspaceId) {
      console.error('apply requires --workspace-id <uuid> (audit log workspace_id is NOT NULL)');
      return 1;
    }
    const result = opts.viaCompose
      ? await applyViaCompose({
          databaseUrl: opts.databaseUrl,
          backupDir: opts.backupDir,
          fromVersion: opts.fromVersion,
          toVersion: opts.toVersion,
        })
      : await applyUpgrade({
          databaseUrl: opts.databaseUrl,
          backupDir: opts.backupDir,
          fromVersion: opts.fromVersion,
          toVersion: opts.toVersion,
          workspaceId: opts.workspaceId,
        });
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  if (command === 'rollback') {
    const result = await rollbackUpgrade({
      databaseUrl: opts.databaseUrl,
      backupDir: opts.backupDir,
      snapshotPath: opts.snapshot,
      workspaceId: opts.workspaceId,
    });
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  if (command === 'healthcheck') {
    const r = await runHealthcheck({ databaseUrl: opts.databaseUrl });
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  console.error(`unknown command: ${command}`);
  printHelp();
  return 1;
}

run()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
