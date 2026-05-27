import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rollbackUpgrade } from '@/lib/upgrade/rollback';

describe('rollbackUpgrade -- snapshot picker', () => {
  it('picks the newest .sql.gz when no path is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-rb-'));
    writeFileSync(join(dir, 'old.sql.gz'), 'x');
    utimesSync(join(dir, 'old.sql.gz'), new Date('2020-01-01'), new Date('2020-01-01'));
    writeFileSync(join(dir, 'new.sql.gz'), 'x');

    const result = await rollbackUpgrade({
      databaseUrl: 'postgres://invalid:5432/x', // won't be touched -- restore will fail; we only verify path selection
      backupDir: dir,
    });
    expect(result.snapshotPath.endsWith('new.sql.gz')).toBe(true);
    expect(result.ok).toBe(false); // restore against bad URL fails -- expected; we only assert the picker
  });

  it('returns error when backupDir has no snapshots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-rb-empty-'));
    const result = await rollbackUpgrade({ databaseUrl: 'postgres://x:5432/y', backupDir: dir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no snapshot');
  });
});
