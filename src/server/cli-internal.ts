export interface DbConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function parseDbUrl(raw: string): DbConnection {
  const u = new URL(raw);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error(`Expected a postgres:// URL, got ${u.protocol}`);
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL is missing a database name');
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

export interface CliArgs {
  command:
    | 'backup'
    | 'restore'
    | 'export'
    | 'import'
    | 'reconcile'
    | 'reminders:scan'
    | 'reindex-embeddings'
    | 'connector:sync'
    | 'trash:purge'
    | 'pages:auto-unlock'
    | 'flashcards:notify-due'
    | 'siem:retry-sweep'
    | 'siem:daily-archive';
  out?: string;
  in?: string;
  fromS3?: string;
  force: boolean;
  retentionDays?: number;
  target?: 'local' | 's3';
  workspace?: string;
  /**
   * v0.9.0 G2 P13 — explicit workspace-id flag used by the trash:purge cron
   * command. Kept separate from `workspace` so callers can't accidentally mix
   * `--workspace <id>` (export/import semantics) with `--workspace-id=<id>`
   * (cron-managed schedule rows).
   */
  workspaceId?: string;
  source?: 'notion' | 'markdown-folder' | 'workspace-archive';
  file?: string;
  batchSize?: number;
  connectorId?: string;
}

const KNOWN_COMMANDS = [
  'backup',
  'restore',
  'export',
  'import',
  'reconcile',
  'reminders:scan',
  'reindex-embeddings',
  'connector:sync',
  'trash:purge',
  // v0.9.0 G2 P14 — single global cron sweep that auto-unlocks pages whose
  // `locked_until` has passed. No flags; reads DATABASE_URL like every other
  // CLI subcommand.
  'pages:auto-unlock',
  // v0.9.0 G3 P19 — global daily sweep that inserts one `flashcards_due`
  // notification per (user, workspace) with at least one due card. Idempotent
  // within a UTC day; no flags.
  'flashcards:notify-due',
  // v0.9.0 G8 P39 — every-minute sweep that re-runs retry-status SIEM
  // deliveries whose next_attempt_at has passed. Per-attempt rows append to
  // siem_delivery_log; the scheduler logs the swept count.
  'siem:retry-sweep',
  // v0.9.0 G8 P40 — daily sweep that gzips yesterday's audit_log rows per
  // workspace + writes them to s3 for every enabled `kind='s3'` forwarder.
  // One delivery-log row per non-empty archive; empty days produce nothing.
  'siem:daily-archive',
] as const;
type Command = (typeof KNOWN_COMMANDS)[number];

export function parseArgs(argv: string[]): CliArgs {
  const command = argv[0];
  const rest = argv.slice(1);
  if (!command || !KNOWN_COMMANDS.includes(command as Command)) {
    throw new Error(
      `Unknown command: ${command ?? '(none)'} (expected ${KNOWN_COMMANDS.join('|')})`,
    );
  }
  const cmd = command as Command;
  let out: string | undefined;
  let inBundle: string | undefined;
  let fromS3: string | undefined;
  let force = false;
  let retentionDays: number | undefined;
  let target: 'local' | 's3' | undefined;
  let workspace: string | undefined;
  let source: CliArgs['source'];
  let file: string | undefined;
  let batchSize: number | undefined;
  let connectorId: string | undefined;
  let workspaceId: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--out') out = rest[++i];
    else if (a === '--in') inBundle = rest[++i];
    else if (a === '--from-s3') fromS3 = rest[++i];
    else if (a === '--force') force = true;
    else if (a === '--retention-days') {
      const raw = rest[++i];
      const n = Number(raw);
      if (raw === undefined || !Number.isInteger(n) || n < 0) {
        throw new Error('--retention-days requires a non-negative integer');
      }
      retentionDays = n;
    } else if (a === '--target') {
      const t = rest[++i];
      if (t !== 'local' && t !== 's3') throw new Error("--target must be 'local' or 's3'");
      target = t;
    } else if (a === '--workspace') workspace = rest[++i];
    else if (a?.startsWith('--workspace-id=')) {
      // v0.9.0 G2 P13 — cron-managed `--workspace-id=<id>` flag (single token,
      // matches the canonical command string the scheduler stores).
      workspaceId = a.slice('--workspace-id='.length);
    } else if (a === '--workspace-id') {
      workspaceId = rest[++i];
    } else if (a === '--source') {
      const s = rest[++i];
      if (s !== 'notion' && s !== 'markdown-folder' && s !== 'workspace-archive') {
        throw new Error("--source must be 'notion' | 'markdown-folder' | 'workspace-archive'");
      }
      source = s;
    } else if (a === '--file') file = rest[++i];
    else if (a === '--batch-size') {
      const raw = rest[++i];
      const n = Number(raw);
      if (raw === undefined || !Number.isInteger(n) || n < 1) {
        throw new Error('--batch-size requires a positive integer');
      }
      batchSize = n;
    } else if (a === '--connector') connectorId = rest[++i];
    else throw new Error(`Unknown flag: ${a}`);
  }
  if (cmd === 'backup' && !out) throw new Error('backup requires --out <dir>');
  if (cmd === 'restore') {
    if (!inBundle && !fromS3) {
      throw new Error('restore requires --in <bundle> or --from-s3 <key>');
    }
    if (inBundle && fromS3) {
      throw new Error('restore: --in and --from-s3 are mutually exclusive');
    }
  }
  if (cmd === 'export' && (!workspace || !out)) {
    throw new Error('export requires --workspace <id> --out <dir>');
  }
  if (cmd === 'import' && (!source || !file || !workspace)) {
    throw new Error('import requires --source <kind> --file <path> --workspace <id>');
  }
  if (cmd === 'trash:purge' && !workspaceId) {
    throw new Error('trash:purge requires --workspace-id=<id>');
  }
  return {
    command: cmd,
    out,
    in: inBundle,
    fromS3,
    force,
    retentionDays,
    target: cmd === 'backup' ? (target ?? 'local') : target,
    workspace,
    workspaceId,
    source,
    file,
    batchSize,
    connectorId,
  };
}
