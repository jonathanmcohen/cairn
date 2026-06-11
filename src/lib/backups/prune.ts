import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * v0.10.0 C3 — keep-N bundle pruning (`backup --keep N`).
 *
 * Complements the age-based `--retention-days` sweep in src/server/cli.ts:
 * retention-days deletes anything older than the cutoff (and can delete
 * EVERYTHING when backups stop being taken for a while), keep-N guarantees the
 * newest N bundles survive regardless of age. When both flags are given the
 * CLI runs retention-days first, then keep-N.
 *
 * A "bundle" is every file sharing one `<ts>` stamp: the `cairn-backup-<ts>`
 * dump (raw or `.enc`), the optional `cairn-uploads-<ts>` tar (raw or `.enc`),
 * and the `cairn-backup-<ts>.manifest.json`. Stamps derive from ISO timestamps
 * with `[:.]` → `-` (see stamp() in src/server/cli.ts), so lexicographic order
 * IS chronological order. Uploaded bundles (C2) carry a `<ts>-uploaded` stamp
 * and group/sort the same way.
 */

const BUNDLE_PATTERNS = [
  /^cairn-backup-(.+)\.manifest\.json$/,
  /^cairn-backup-(.+)\.dump\.enc$/,
  /^cairn-backup-(.+)\.dump$/,
  /^cairn-uploads-(.+)\.tar\.gz\.enc$/,
  /^cairn-uploads-(.+)\.tar\.gz$/,
];

/** Extract the `<ts>` stamp from a bundle file name; null for non-bundle files. */
export function bundleStamp(fileName: string): string | null {
  for (const re of BUNDLE_PATTERNS) {
    const m = fileName.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Group bundle file names by their `<ts>` stamp. Non-bundle files are ignored. */
export function groupBundleFilesByStamp(fileNames: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const name of fileNames) {
    const stamp = bundleStamp(name);
    if (!stamp) continue;
    const files = groups.get(stamp);
    if (files) files.push(name);
    else groups.set(stamp, [name]);
  }
  return groups;
}

/**
 * Pure core of keep-N: given a directory listing, return the file names that
 * belong to stamps OLDER than the newest `keep` stamps. Non-bundle files are
 * never returned (a stray README in the backup dir must survive).
 */
export function selectKeepNPruneTargets(fileNames: string[], keep: number): string[] {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`keep must be a positive integer, got ${keep}`);
  }
  const groups = groupBundleFilesByStamp(fileNames);
  // Newest-first: the stamp encodes an ISO timestamp with [:.] → '-', so a
  // plain descending lexicographic sort is a descending chronological sort.
  const stamps = [...groups.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const doomed = stamps.slice(keep);
  return doomed.flatMap((stamp) => groups.get(stamp) ?? []);
}

/**
 * Delete every bundle file outside the newest `keep` stamps in `outDir`.
 * Returns the deleted file names (for logging). Used by the CLI's
 * `backup --keep N` path AFTER the dump succeeded, so the bundle just written
 * always counts toward (and survives) the keep window.
 */
export async function pruneBundlesKeepN(outDir: string, keep: number): Promise<string[]> {
  const targets = selectKeepNPruneTargets(await readdir(outDir), keep);
  for (const name of targets) {
    await rm(join(outDir, name), { force: true });
  }
  return targets;
}
