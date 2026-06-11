import { ENVELOPE_MAGIC } from './encryption-envelope';

/**
 * v0.10.0 C2 — magic-byte sniff for uploaded backup bundles.
 *
 * The upload route accepts exactly two artefact shapes the restore CLI can
 * consume: a raw pg_dump custom-format archive (`.dump`, starts with "PGDMP")
 * or its AES-256-GCM envelope (`.dump.enc`, starts with CAIRN-ENC-BAK-v1 —
 * see encryption-envelope.ts). The sniff is MAGIC-ONLY by design: a truncated
 * or otherwise corrupt archive with a valid magic is accepted here and left
 * for pg_restore to reject at restore time, because validating a full custom
 * format archive server-side would mean re-implementing pg_restore.
 */

/** pg_dump custom-format archives start with these 5 bytes. */
export const DUMP_MAGIC = Buffer.from('PGDMP', 'utf8');

/** Minimum number of leading bytes the sniff needs to decide. */
export const SNIFF_BYTES = Math.max(DUMP_MAGIC.length, ENVELOPE_MAGIC.length);

export type SniffResult =
  | { ok: true; kind: 'dump' | 'dump.enc' }
  | { ok: false; reason: 'bad-extension' | 'bad-magic' };

/**
 * Decide whether an uploaded file is a restorable backup bundle. The expected
 * magic is chosen by extension (`.dump` ⇒ PGDMP, `.dump.enc` ⇒ envelope), so
 * a plaintext dump renamed to `.enc` (or vice versa) is rejected rather than
 * stored under a name the restore CLI would mis-handle.
 */
export function sniffBackupUpload(filename: string, header: Buffer | Uint8Array): SniffResult {
  const head = Buffer.isBuffer(header) ? header : Buffer.from(header);
  if (filename.endsWith('.dump.enc')) {
    return head.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)
      ? { ok: true, kind: 'dump.enc' }
      : { ok: false, reason: 'bad-magic' };
  }
  if (filename.endsWith('.dump')) {
    return head.subarray(0, DUMP_MAGIC.length).equals(DUMP_MAGIC)
      ? { ok: true, kind: 'dump' }
      : { ok: false, reason: 'bad-magic' };
  }
  return { ok: false, reason: 'bad-extension' };
}
