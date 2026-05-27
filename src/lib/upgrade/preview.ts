import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { compareJournalToDb, loadBundledJournal } from './migrations';

export type PreviewResult = {
  ok: boolean;
  pendingTags: string[];
  schemaDiff: string;
  error?: string;
};

/**
 * Read-only dry run. Strategy:
 *
 *  1. Connect to the target databaseUrl; capture pre-upgrade schema via
 *     `pg_dump --schema-only`.
 *  2. Create a scratch database `cairn_preview_<uuid>` on the same Postgres
 *     instance; clone schema + data into it.
 *  3. Run pending Drizzle migrations against the scratch DB.
 *  4. Capture post-upgrade schema; line-diff it against (1).
 *  5. Drop the scratch DB.
 *  6. Compare bundled journal against the ORIGINAL DB to list pending tags.
 *
 * Production data is never read into the diff (schema-only). Production
 * schema is never mutated.
 */
export async function previewUpgrade(input: { databaseUrl: string }): Promise<PreviewResult> {
  const journal = await loadBundledJournal();
  const targetClient = postgres(input.databaseUrl, { max: 1 });
  const targetDb = drizzle(targetClient);
  const cmp = await compareJournalToDb({ journal, db: targetDb });
  await targetClient.end();

  if (cmp.pending.length === 0) {
    return { ok: true, pendingTags: [], schemaDiff: '' };
  }

  const adminUrl = new URL(input.databaseUrl);
  adminUrl.pathname = '/postgres';
  const scratchName = `cairn_preview_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  const admin = postgres(adminUrl.toString(), { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${scratchName}"`);
  } finally {
    await admin.end();
  }

  const tmp = mkdtempSync(join(tmpdir(), 'cairn-preview-'));
  const beforeDump = join(tmp, 'before.sql');
  const afterDump = join(tmp, 'after.sql');
  const scratchUrl = withDb(input.databaseUrl, scratchName);

  try {
    await spawnOk('pg_dump', ['--schema-only', input.databaseUrl], { writeTo: beforeDump });
    await pipeDumpInto(input.databaseUrl, scratchUrl);

    const scratchClient = postgres(scratchUrl, { max: 1 });
    try {
      const scratchDb = drizzle(scratchClient);
      await migrate(scratchDb, { migrationsFolder: 'drizzle/migrations' });
    } finally {
      await scratchClient.end();
    }

    await spawnOk('pg_dump', ['--schema-only', scratchUrl], { writeTo: afterDump });
    const before = readFileSync(beforeDump, 'utf8');
    const after = readFileSync(afterDump, 'utf8');
    const diff = unifiedDiff(before, after);
    return { ok: true, pendingTags: cmp.pending.map((e) => e.tag), schemaDiff: diff };
  } catch (err) {
    return {
      ok: false,
      pendingTags: cmp.pending.map((e) => e.tag),
      schemaDiff: '',
      error: (err as Error).message,
    };
  } finally {
    const cleanup = postgres(adminUrl.toString(), { max: 1 });
    try {
      await cleanup.unsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    } catch {
      // best-effort cleanup; surface nothing if it fails
    } finally {
      await cleanup.end();
    }
  }
}

function withDb(databaseUrl: string, dbName: string): string {
  const u = new URL(databaseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function spawnOk(
  cmd: string,
  args: string[],
  opts?: { writeTo?: string },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', opts?.writeTo ? 'pipe' : 'inherit', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    if (opts?.writeTo && proc.stdout) {
      const sink = createWriteStream(opts.writeTo);
      proc.stdout.pipe(sink);
      sink.on('error', reject);
    }
    proc.on('error', reject);
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr}`)),
    );
  });
}

async function pipeDumpInto(sourceUrl: string, targetUrl: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const dump = spawn('pg_dump', ['--clean', '--if-exists', '--no-owner', sourceUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const psql = spawn('psql', [targetUrl], { stdio: ['pipe', 'inherit', 'pipe'] });
    let stderr = '';
    dump.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    psql.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    if (dump.stdout && psql.stdin) dump.stdout.pipe(psql.stdin);
    psql.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`psql exited ${code}: ${stderr}`)),
    );
    dump.on('error', reject);
    psql.on('error', reject);
  });
}

function unifiedDiff(a: string, b: string): string {
  const aLines = new Set(
    a
      .split('\n')
      .map((l) => l)
      .filter((l) => l.trim() && !l.startsWith('--')),
  );
  const bLines = b
    .split('\n')
    .map((l) => l)
    .filter((l) => l.trim() && !l.startsWith('--'));
  const bSet = new Set(bLines);
  const out: string[] = [];
  for (const l of bLines) if (!aLines.has(l)) out.push(`+ ${l}`);
  for (const l of a.split('\n').filter((l) => l.trim() && !l.startsWith('--'))) {
    if (!bSet.has(l)) out.push(`- ${l}`);
  }
  return out.join('\n');
}
