import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listBackupBundles } from '@/lib/backups/list';

// v0.10.0 C1 — pure-fs unit for the bundle lister behind /api/admin/backups.
// No DB / Docker required: everything runs against a tmp dir shaped like the
// backup CLI's output (cairn-backup-<ts>.manifest.json + sibling archives).

function manifest(createdAt: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '0.10.0',
    createdAt,
    fileBackend: 'local',
    database: 'cairn',
    encrypted: false,
    ...overrides,
  });
}

describe('listBackupBundles', () => {
  it('returns an empty list for a missing directory (fresh install, not an error)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-c1-list-'));
    await expect(listBackupBundles(join(dir, 'does-not-exist'))).resolves.toEqual([]);
  });

  it('returns an empty list for a directory with no manifests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-c1-list-'));
    await writeFile(join(dir, 'unrelated.txt'), 'hi');
    await expect(listBackupBundles(dir)).resolves.toEqual([]);
  });

  it('lists bundles newest-first with archive sizes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-c1-list-'));
    const tsOld = '2026-01-01T00-00-00-000Z';
    const tsNew = '2026-06-01T00-00-00-000Z';

    await writeFile(
      join(dir, `cairn-backup-${tsOld}.manifest.json`),
      manifest('2026-01-01T00:00:00.000Z'),
    );
    await writeFile(join(dir, `cairn-backup-${tsOld}.dump`), Buffer.alloc(100));
    await writeFile(join(dir, `cairn-uploads-${tsOld}.tar.gz`), Buffer.alloc(50));

    await writeFile(
      join(dir, `cairn-backup-${tsNew}.manifest.json`),
      manifest('2026-06-01T00:00:00.000Z'),
    );
    await writeFile(join(dir, `cairn-backup-${tsNew}.dump`), Buffer.alloc(200));
    await writeFile(join(dir, `cairn-uploads-${tsNew}.tar.gz`), Buffer.alloc(75));

    const bundles = await listBackupBundles(dir);
    expect(bundles.map((b) => b.ts)).toEqual([tsNew, tsOld]);
    expect(bundles[0]).toMatchObject({
      ts: tsNew,
      createdAt: '2026-06-01T00:00:00.000Z',
      version: '0.10.0',
      database: 'cairn',
      fileBackend: 'local',
      encrypted: false,
      dumpBytes: 200,
      uploadsBytes: 75,
    });
    expect(bundles[1]).toMatchObject({ dumpBytes: 100, uploadsBytes: 50 });
  });

  it('skips a malformed manifest without dropping the healthy ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-c1-list-'));
    const good = '2026-03-01T00-00-00-000Z';
    await writeFile(
      join(dir, `cairn-backup-${good}.manifest.json`),
      manifest('2026-03-01T00:00:00.000Z'),
    );
    await writeFile(join(dir, `cairn-backup-${good}.dump`), Buffer.alloc(10));
    // Not JSON at all.
    await writeFile(join(dir, 'cairn-backup-broken-1.manifest.json'), 'not json {{{');
    // Valid JSON, wrong shape (encrypted is a string).
    await writeFile(
      join(dir, 'cairn-backup-broken-2.manifest.json'),
      manifest('2026-03-02T00:00:00.000Z', { encrypted: 'yes' }),
    );

    const bundles = await listBackupBundles(dir);
    expect(bundles.map((b) => b.ts)).toEqual([good]);
  });

  it('sizes encrypted .enc siblings and reports uploadsBytes null when absent (s3 backend)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-c1-list-'));
    const ts = '2026-04-01T00-00-00-000Z';
    await writeFile(
      join(dir, `cairn-backup-${ts}.manifest.json`),
      manifest('2026-04-01T00:00:00.000Z', { encrypted: true, fileBackend: 's3' }),
    );
    await writeFile(join(dir, `cairn-backup-${ts}.dump.enc`), Buffer.alloc(123));

    const bundles = await listBackupBundles(dir);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({
      encrypted: true,
      fileBackend: 's3',
      dumpBytes: 123,
      uploadsBytes: null,
    });
  });
});
