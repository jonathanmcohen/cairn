import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const hasPgDump = (() => {
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const cliPath = join(process.cwd(), 'dist/server/cli.js');

describe.skipIf(!hasPgDump)('backup/restore round-trip', () => {
  let pg: StartedPostgreSqlContainer;
  let url: string;
  let outDir: string;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:16').start();
    url = pg.getConnectionUri();
    outDir = mkdtempSync(join(tmpdir(), 'cairn-bak-'));
    const sql = postgres(url);
    await sql`CREATE TABLE keepme (id int primary key, note text)`;
    await sql`INSERT INTO keepme (id, note) VALUES (1, 'survive-me')`;
    await sql.end();
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it('backs up, drops, and restores the row', async () => {
    const env = { ...process.env, DATABASE_URL: url, FILE_BACKEND: 's3' }; // s3 skips the uploads tar
    execFileSync('node', [cliPath, 'backup', '--out', outDir], { env, stdio: 'inherit' });

    const sql = postgres(url);
    await sql`DROP TABLE keepme`;
    await sql.end();

    const dump = readdirSync(outDir).find((f: string) => f.endsWith('.dump'));
    if (!dump) throw new Error('no .dump produced by backup');
    execFileSync('node', [cliPath, 'restore', '--in', join(outDir, dump), '--force'], {
      env,
      stdio: 'inherit',
    });

    const check = postgres(url);
    const rows = await check`SELECT note FROM keepme WHERE id = 1`;
    await check.end();
    expect(rows[0]?.note).toBe('survive-me');
  }, 120_000);
});

describe('restore --force gate', () => {
  it('refuses (non-zero) without --force when stdin is non-interactive', () => {
    const env = { ...process.env, DATABASE_URL: 'postgres://u:p@localhost:5432/cairn' };
    let exitCode = 0;
    try {
      // No --force and stdin is ignored (non-interactive) → must refuse, never spawn pg_restore.
      execFileSync('node', [cliPath, 'restore', '--in', '/tmp/does-not-exist.dump'], {
        env,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? 1;
    }
    expect(exitCode).not.toBe(0);
  });
});
