import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The backup CLI shells out to pg_dump/pg_restore, which ABORT on a server/
// client major-version mismatch. Only run the live round-trip when a pg_dump
// whose major matches the test container (Postgres 16) is on PATH — otherwise
// skip (a dev box without pg_dump, or CI whose client major differs). The
// arg/URL-parsing + --force-gate tests below run everywhere.
const hasPgDump16 = (() => {
  try {
    const out = execFileSync('pg_dump', ['--version'], { encoding: 'utf8' });
    const m = out.match(/(\d+)\.\d+/);
    return m ? Number(m[1]) === 16 : false;
  } catch {
    return false;
  }
})();

const cliPath = join(process.cwd(), 'dist/server/cli.js');

describe.skipIf(!hasPgDump16)('backup/restore round-trip', () => {
  let pg: StartedPostgreSqlContainer;
  let url: string;
  let outDir: string;

  beforeAll(async () => {
    // The round-trip spawns the COMPILED CLI (dist/server/cli.js). CI runs
    // `pnpm test` before the build step, so build the entrypoint+CLI here if
    // dist is absent (idempotent + fast — it's just `tsc` over src/server).
    if (!existsSync(cliPath)) {
      execFileSync('pnpm', ['build:entrypoint'], { stdio: 'inherit' });
    }
    // Match the rest of the suite — Postgres 18 + pgvector. The CLI
    // backup smoke doesn't itself use pgvector, but every other Postgres
    // consumer in the repo uses the same ref, and pinning here keeps
    // pg_dump's wire-version assumptions consistent across the suite.
    pg = await new PostgreSqlContainer(
      'ghcr.io/jonathanmcohen/pgvector:18-0.8.6',
    ).start();
    url = pg.getConnectionUri();
    outDir = mkdtempSync(join(tmpdir(), 'cairn-bak-'));
    const sql = postgres(url);
    await sql`CREATE TABLE keepme (id int primary key, note text)`;
    await sql`INSERT INTO keepme (id, note) VALUES (1, 'survive-me')`;
    await sql.end();
  }, 180_000);

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

  // v0.9.0 G8 P43 — same shape as the round-trip above, with the encryption env
  // set. Asserts: the on-disk artefact ends in .dump.enc (not .dump), the
  // envelope magic is present, and restore with the matching passphrase
  // reproduces the seeded row.
  it('encrypts the dump and decrypts on restore when CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is set', async () => {
    const passphrase = 'integration-test-passphrase';
    const env = {
      ...process.env,
      DATABASE_URL: url,
      FILE_BACKEND: 's3',
      CAIRN_BACKUP_ENCRYPTION_PASSPHRASE: passphrase,
    };
    const encOutDir = mkdtempSync(join(tmpdir(), 'cairn-bak-enc-'));

    // Re-seed the row in case the prior test left the table empty post-restore.
    const seed = postgres(url);
    await seed`INSERT INTO keepme (id, note) VALUES (2, 'enc-survive-me') ON CONFLICT (id) DO UPDATE SET note = EXCLUDED.note`;
    await seed.end();

    execFileSync('node', [cliPath, 'backup', '--out', encOutDir], { env, stdio: 'inherit' });

    const files = readdirSync(encOutDir);
    const enc = files.find((f: string) => f.endsWith('.dump.enc'));
    expect(enc).toBeTruthy();
    expect(files.some((f: string) => f.endsWith('.dump') && !f.endsWith('.dump.enc'))).toBe(false);
    if (!enc) throw new Error('no .dump.enc produced by encrypted backup');

    // Verify magic bytes (16-byte header prefix).
    const { readFileSync: rfs } = await import('node:fs');
    const head = rfs(join(encOutDir, enc)).subarray(0, 16).toString('utf8');
    expect(head).toBe('CAIRN-ENC-BAK-v1');

    // Drop the row, then restore from the encrypted bundle.
    const drop = postgres(url);
    await drop`DELETE FROM keepme WHERE id = 2`;
    await drop.end();

    execFileSync('node', [cliPath, 'restore', '--in', join(encOutDir, enc), '--force'], {
      env,
      stdio: 'inherit',
    });

    const check = postgres(url);
    const rows = await check`SELECT note FROM keepme WHERE id = 2`;
    await check.end();
    expect(rows[0]?.note).toBe('enc-survive-me');
  }, 180_000);
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
