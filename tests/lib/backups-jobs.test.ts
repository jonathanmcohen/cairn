import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getBackupJob, startBackupJob } from '@/lib/backups/jobs';

// v0.10.0 C1 — pure-fs unit for the in-process backup-job registry. No DB /
// Docker required. The pg_dump probe and the CLI path are both overridable so
// the tests neither need a real Postgres client nor the compiled CLI bundle:
// - probe override 'node' = a binary guaranteed present (the test runtime);
// - cliPath stubs are tiny node scripts in a tmp dir.

/** Write a stub CLI script and return its path. */
async function writeStubCli(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cairn-c1-jobs-'));
  const stubPath = join(dir, 'stub-cli.mjs');
  await writeFile(stubPath, body);
  return stubPath;
}

describe('startBackupJob', () => {
  it('returns the typed pg_dump-not-found failure when the probe binary is missing', () => {
    const result = startBackupJob({
      dir: '/tmp/never-used',
      pgDumpBinary: 'definitely-not-a-real-binary',
    });
    expect(result).toEqual({ ok: false, error: 'pg_dump-not-found' });
  });

  it('flips running → done when the CLI exits 0, and the bundle landed in dir', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'cairn-c1-out-'));
    // Mimics `cli backup --out <dir>`: writes a manifest into --out, exits 0.
    const stub = await writeStubCli(
      `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[process.argv.indexOf('--out') + 1];
writeFileSync(
  join(out, 'cairn-backup-2026-06-10T00-00-00-000Z.manifest.json'),
  JSON.stringify({
    version: 'stub',
    createdAt: new Date().toISOString(),
    fileBackend: 'local',
    database: 'cairn',
    encrypted: false,
  }),
);
`,
    );

    const result = startBackupJob({ dir: outDir, cliPath: stub, pgDumpBinary: 'node' });
    if (!result.ok) throw new Error(`expected ok start, got ${result.error}`);
    expect(result.job.status).toBe('running');

    await vi.waitFor(
      () => {
        expect(getBackupJob(result.job.id)?.status).toBe('done');
      },
      { timeout: 15_000 },
    );
    const job = getBackupJob(result.job.id);
    expect(job?.error).toBeUndefined();
    expect(job?.finishedAt).toBeDefined();
    await expect(readdir(outDir)).resolves.toContain(
      'cairn-backup-2026-06-10T00-00-00-000Z.manifest.json',
    );
  });

  it('flips running → failed with the exit code + stderr tail when the CLI exits non-zero', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'cairn-c1-out-'));
    const stub = await writeStubCli(
      `process.stderr.write('pg_dump: connection refused');
process.exit(3);
`,
    );

    const result = startBackupJob({ dir: outDir, cliPath: stub, pgDumpBinary: 'node' });
    if (!result.ok) throw new Error(`expected ok start, got ${result.error}`);

    await vi.waitFor(
      () => {
        expect(getBackupJob(result.job.id)?.status).toBe('failed');
      },
      { timeout: 15_000 },
    );
    const job = getBackupJob(result.job.id);
    expect(job?.error).toContain('exited with code 3');
    expect(job?.error).toContain('connection refused');
  });

  it('getBackupJob returns undefined for an unknown id', () => {
    expect(getBackupJob('00000000-0000-0000-0000-000000000000')).toBeUndefined();
  });
});
