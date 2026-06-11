import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseNameFromUrl } from '@/lib/backups/db-name';
import { getBackupJob, startRestoreJob } from '@/lib/backups/jobs';
import { disengageMaintenance, getMaintenance } from '@/lib/backups/maintenance';

// v0.10.0 C2 — pure-fs unit for startRestoreJob + the maintenance flag + the
// confirm-gate parse helper. No DB / Docker required: cliPath stubs are tiny
// node scripts in a tmp dir, exactly like the C1 backup-job units.
//
// This file also owns the encrypted-bundle-without-passphrase branch (the
// cli.ts restore() failure class, surfaced as an upfront typed error): the e2e
// spec cannot exercise it because Playwright can't write a fabricated .enc
// file into the booted server's CAIRN_BACKUP_DIR.

const TS = '2026-06-10T00-00-00-000Z';

/** Write a bundle dir containing cairn-backup-<TS>.dump[.enc]; returns dir. */
async function writeBundleDir(ext: '.dump' | '.dump.enc'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cairn-c2-restore-'));
  await writeFile(join(dir, `cairn-backup-${TS}${ext}`), 'PGDMP-stub');
  return dir;
}

/** Write a stub CLI script into its own tmp dir and return its path. */
async function writeStubCli(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cairn-c2-cli-'));
  const stubPath = join(dir, 'stub-cli.mjs');
  await writeFile(stubPath, body);
  return stubPath;
}

afterEach(() => {
  // Never leak an engaged flag into other tests (the registry/flag are
  // module-level and the suite runs files in one worker).
  disengageMaintenance();
  vi.unstubAllEnvs();
});

describe('startRestoreJob', () => {
  it('returns the typed bundle-missing failure and does NOT engage maintenance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-c2-empty-'));
    const result = startRestoreJob({ dir, ts: TS, cliPath: '/never-spawned.mjs' });
    expect(result).toEqual({ ok: false, error: 'bundle-missing' });
    expect(getMaintenance().active).toBe(false);
  });

  it('fails upfront for a .enc bundle when CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is unset', async () => {
    // Empty string is falsy — equivalent to unset for the jobs-module check,
    // and stubEnv restores the operator's real value afterwards.
    vi.stubEnv('CAIRN_BACKUP_ENCRYPTION_PASSPHRASE', '');
    const dir = await writeBundleDir('.dump.enc');
    const result = startRestoreJob({ dir, ts: TS, cliPath: '/never-spawned.mjs' });
    expect(result).toEqual({ ok: false, error: 'encrypted-passphrase-missing' });
    expect(getMaintenance().active).toBe(false);
  });

  it('starts a .enc bundle when the passphrase IS set', async () => {
    vi.stubEnv('CAIRN_BACKUP_ENCRYPTION_PASSPHRASE', 'unit-passphrase');
    const dir = await writeBundleDir('.dump.enc');
    const stub = await writeStubCli('process.exit(0);\n');
    const result = startRestoreJob({ dir, ts: TS, cliPath: stub });
    if (!result.ok) throw new Error(`expected ok start, got ${result.error}`);
    await vi.waitFor(
      () => {
        expect(getBackupJob(result.job.id)?.status).toBe('done');
      },
      { timeout: 15_000 },
    );
  });

  it('engages maintenance for the whole run, passes restore args, and disengages on success', async () => {
    const dir = await writeBundleDir('.dump');
    // Sleeps briefly so the test can observe the engaged window, and records
    // its argv so we can assert the exact CLI invocation.
    const stub = await writeStubCli(
      `import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[1] + '.argv.json', JSON.stringify(process.argv.slice(2)));
setTimeout(() => process.exit(0), 300);
`,
    );

    const result = startRestoreJob({ dir, ts: TS, cliPath: stub });
    if (!result.ok) throw new Error(`expected ok start, got ${result.error}`);
    expect(result.job.kind).toBe('restore');
    expect(result.job.status).toBe('running');
    // Engaged BEFORE the spawn returns, so the proxy gate covers the whole
    // pg_restore window with no startup gap.
    const during = getMaintenance();
    expect(during.active).toBe(true);
    if (during.active) {
      expect(during.reason).toBe('restore');
      expect(Date.parse(during.since)).not.toBeNaN();
    }

    await vi.waitFor(
      () => {
        expect(getBackupJob(result.job.id)?.status).toBe('done');
      },
      { timeout: 15_000 },
    );
    expect(getMaintenance().active).toBe(false);
    expect(getBackupJob(result.job.id)?.finishedAt).toBeDefined();

    const argv = JSON.parse(await readFile(`${stub}.argv.json`, 'utf8')) as string[];
    expect(argv).toEqual(['restore', '--in', join(dir, `cairn-backup-${TS}.dump`), '--force']);
  });

  it('a failing CLI also disengages maintenance and keeps the stderr tail', async () => {
    const dir = await writeBundleDir('.dump');
    const stub = await writeStubCli(
      `process.stderr.write('pg_restore: error: connection refused');
process.exit(2);
`,
    );

    const result = startRestoreJob({ dir, ts: TS, cliPath: stub });
    if (!result.ok) throw new Error(`expected ok start, got ${result.error}`);
    expect(getMaintenance().active).toBe(true);

    await vi.waitFor(
      () => {
        expect(getBackupJob(result.job.id)?.status).toBe('failed');
      },
      { timeout: 15_000 },
    );
    expect(getMaintenance().active).toBe(false);
    const job = getBackupJob(result.job.id);
    expect(job?.error).toContain('exited with code 2');
    expect(job?.error).toContain('connection refused');
  });

  it('refuses a second restore while one is running (maintenance-active)', async () => {
    const dir = await writeBundleDir('.dump');
    const stub = await writeStubCli('setTimeout(() => process.exit(0), 300);\n');

    const first = startRestoreJob({ dir, ts: TS, cliPath: stub });
    if (!first.ok) throw new Error(`expected ok start, got ${first.error}`);
    const second = startRestoreJob({ dir, ts: TS, cliPath: stub });
    expect(second).toEqual({ ok: false, error: 'maintenance-active' });

    await vi.waitFor(
      () => {
        expect(getBackupJob(first.job.id)?.status).toBe('done');
      },
      { timeout: 15_000 },
    );
    expect(getMaintenance().active).toBe(false);
  });
});

describe('databaseNameFromUrl', () => {
  it('parses the database name the same way the restore CLI does', () => {
    expect(databaseNameFromUrl('postgres://user:pass@localhost:5432/cairn_e2e')).toBe('cairn_e2e');
    expect(databaseNameFromUrl('postgresql://u@db.internal/cairn')).toBe('cairn');
  });

  it('decodes percent-encoded names (matching parseDbUrl)', () => {
    expect(databaseNameFromUrl('postgres://u:p@h:5432/my%20db')).toBe('my db');
  });

  it('throws for non-postgres URLs and missing database names', () => {
    expect(() => databaseNameFromUrl('mysql://u:p@h/db')).toThrow(/postgres/);
    expect(() => databaseNameFromUrl('postgres://u:p@h:5432/')).toThrow(/database name/);
  });
});
