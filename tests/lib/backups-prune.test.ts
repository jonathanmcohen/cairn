import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundleStamp,
  groupBundleFilesByStamp,
  pruneBundlesKeepN,
  selectKeepNPruneTargets,
} from '@/lib/backups/prune';

// v0.10.0 C3 — keep-N bundle pruning. Stamps mirror cli.ts stamp(): ISO with
// [:.] → '-'; lexicographic order is chronological order.
const TS_OLD = '2026-06-01T03-00-00-000Z';
const TS_MID = '2026-06-02T03-00-00-000Z';
const TS_NEW = '2026-06-03T03-00-00-000Z';

function bundleFiles(ts: string, opts?: { enc?: boolean; uploads?: boolean }): string[] {
  const enc = opts?.enc ? '.enc' : '';
  const files = [`cairn-backup-${ts}.dump${enc}`, `cairn-backup-${ts}.manifest.json`];
  if (opts?.uploads !== false) files.push(`cairn-uploads-${ts}.tar.gz${enc}`);
  return files;
}

describe('bundleStamp', () => {
  it('extracts the stamp from every bundle artefact shape', () => {
    expect(bundleStamp(`cairn-backup-${TS_OLD}.dump`)).toBe(TS_OLD);
    expect(bundleStamp(`cairn-backup-${TS_OLD}.dump.enc`)).toBe(TS_OLD);
    expect(bundleStamp(`cairn-backup-${TS_OLD}.manifest.json`)).toBe(TS_OLD);
    expect(bundleStamp(`cairn-uploads-${TS_OLD}.tar.gz`)).toBe(TS_OLD);
    expect(bundleStamp(`cairn-uploads-${TS_OLD}.tar.gz.enc`)).toBe(TS_OLD);
    // C2 uploaded bundles carry a -uploaded suffix inside the stamp.
    expect(bundleStamp(`cairn-backup-${TS_OLD}-uploaded.dump`)).toBe(`${TS_OLD}-uploaded`);
  });

  it('returns null for non-bundle files', () => {
    expect(bundleStamp('README.md')).toBeNull();
    expect(bundleStamp('cairn-backup-.dump.bak')).toBeNull();
    expect(bundleStamp('unrelated-2026.dump')).toBeNull();
  });
});

describe('groupBundleFilesByStamp', () => {
  it('groups dump + uploads + manifest under one stamp and skips strangers', () => {
    const names = [...bundleFiles(TS_OLD), ...bundleFiles(TS_NEW, { enc: true }), 'notes.txt'];
    const groups = groupBundleFilesByStamp(names);
    expect([...groups.keys()].sort()).toEqual([TS_OLD, TS_NEW]);
    expect(groups.get(TS_OLD)).toHaveLength(3);
    expect(groups.get(TS_NEW)).toHaveLength(3);
  });
});

describe('selectKeepNPruneTargets', () => {
  it('keeps the newest N stamps and dooms every file of older stamps', () => {
    const names = [...bundleFiles(TS_MID), ...bundleFiles(TS_OLD), ...bundleFiles(TS_NEW)];
    const doomed = selectKeepNPruneTargets(names, 2).sort();
    expect(doomed).toEqual(bundleFiles(TS_OLD).sort());
  });

  it('returns nothing when there are fewer stamps than keep', () => {
    expect(selectKeepNPruneTargets(bundleFiles(TS_NEW), 2)).toEqual([]);
  });

  it('never targets non-bundle files', () => {
    const names = ['precious.txt', ...bundleFiles(TS_OLD), ...bundleFiles(TS_NEW)];
    expect(selectKeepNPruneTargets(names, 1)).not.toContain('precious.txt');
  });

  it('rejects a non-positive keep', () => {
    expect(() => selectKeepNPruneTargets([], 0)).toThrow(/positive integer/);
    expect(() => selectKeepNPruneTargets([], 1.5)).toThrow(/positive integer/);
  });
});

describe('pruneBundlesKeepN', () => {
  it('deletes the oldest stamp (dump + uploads + manifest) on disk, keeps the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-keepn-'));
    const all = [
      ...bundleFiles(TS_OLD),
      ...bundleFiles(TS_MID),
      ...bundleFiles(TS_NEW),
      'keep-me.txt',
    ];
    for (const name of all) {
      await writeFile(join(dir, name), 'x');
    }

    const pruned = await pruneBundlesKeepN(dir, 2);
    expect(pruned.sort()).toEqual(bundleFiles(TS_OLD).sort());

    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual(
      [...bundleFiles(TS_MID), ...bundleFiles(TS_NEW), 'keep-me.txt'].sort(),
    );
    // The oldest stamp's manifest is gone too — the UI lists bundles by
    // manifest, so a survivor manifest would show a ghost bundle.
    expect(remaining).not.toContain(`cairn-backup-${TS_OLD}.manifest.json`);
  });
});
