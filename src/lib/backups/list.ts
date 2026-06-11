import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * v0.10.0 C1 — read-side of the backup snapshot UI. Scans a bundle directory
 * (CAIRN_BACKUP_DIR) for the `cairn-backup-<ts>.manifest.json` files the
 * backup CLI writes (src/server/cli.ts) and joins each manifest with the
 * on-disk sizes of its sibling archives. Pure fs — no DB — so the admin list
 * route and the settings RSC can call it directly and units can test it
 * against a tmp dir.
 */

// Shape written by `cli backup` since v0.5 P5 (encrypted flag added in v0.9.0
// G8 P43). Validated per-file so one hand-edited/corrupt manifest can't take
// down the whole listing.
const Manifest = z.object({
  version: z.string(),
  createdAt: z.string(),
  fileBackend: z.string(),
  database: z.string(),
  encrypted: z.boolean(),
});

export type BackupBundle = {
  /** Bundle timestamp slug, e.g. `2026-06-10T12-00-00-000Z`. */
  ts: string;
  createdAt: string;
  version: string;
  database: string;
  fileBackend: string;
  encrypted: boolean;
  /** Size of cairn-backup-<ts>.dump[.enc]; 0 when the dump file is missing. */
  dumpBytes: number;
  /** Size of cairn-uploads-<ts>.tar.gz[.enc]; null when absent (FILE_BACKEND=s3). */
  uploadsBytes: number | null;
};

const MANIFEST_RE = /^cairn-backup-(.+)\.manifest\.json$/;

/** Stat `<base>` then `<base>.enc`; null when neither exists. */
async function sizeOf(dir: string, base: string): Promise<number | null> {
  for (const name of [base, `${base}.enc`]) {
    try {
      return (await stat(join(dir, name))).size;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * List the backup bundles in `dir`, newest first. A missing directory is the
 * fresh-install steady state (no bundle has ever been written), so it returns
 * an empty list rather than throwing; malformed manifests are skipped.
 */
export async function listBackupBundles(dir: string): Promise<BackupBundle[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const bundles: BackupBundle[] = [];
  for (const name of names) {
    const match = MANIFEST_RE.exec(name);
    const ts = match?.[1];
    if (!ts) continue;

    let manifest: z.infer<typeof Manifest>;
    try {
      manifest = Manifest.parse(JSON.parse(await readFile(join(dir, name), 'utf8')));
    } catch {
      continue; // malformed manifest — skip the bundle, keep listing the rest
    }

    bundles.push({
      ts,
      createdAt: manifest.createdAt,
      version: manifest.version,
      database: manifest.database,
      fileBackend: manifest.fileBackend,
      encrypted: manifest.encrypted,
      dumpBytes: (await sizeOf(dir, `cairn-backup-${ts}.dump`)) ?? 0,
      uploadsBytes: await sizeOf(dir, `cairn-uploads-${ts}.tar.gz`),
    });
  }

  // createdAt is an ISO-8601 string, so lexicographic order is chronological.
  return bundles.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
