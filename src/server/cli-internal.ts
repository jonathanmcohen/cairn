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
    | 'connector:sync';
  out?: string;
  in?: string;
  fromS3?: string;
  force: boolean;
  retentionDays?: number;
  target?: 'local' | 's3';
  workspace?: string;
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
    else if (a === '--source') {
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
  return {
    command: cmd,
    out,
    in: inBundle,
    fromS3,
    force,
    retentionDays,
    target: cmd === 'backup' ? (target ?? 'local') : target,
    workspace,
    source,
    file,
    batchSize,
    connectorId,
  };
}
