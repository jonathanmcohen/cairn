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
  command: 'backup' | 'restore';
  out?: string;
  in?: string;
  force: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (command !== 'backup' && command !== 'restore') {
    throw new Error(`Unknown command: ${command ?? '(none)'} (expected backup|restore)`);
  }
  let out: string | undefined;
  let inBundle: string | undefined;
  let force = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--out') out = rest[++i];
    else if (a === '--in') inBundle = rest[++i];
    else if (a === '--force') force = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  if (command === 'backup' && !out) throw new Error('backup requires --out <dir>');
  if (command === 'restore' && !inBundle) throw new Error('restore requires --in <bundle>');
  return command === 'backup' ? { command, out, force } : { command, in: inBundle, force };
}
