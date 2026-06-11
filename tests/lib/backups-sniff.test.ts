import { describe, expect, it } from 'vitest';
import { ENVELOPE_MAGIC } from '@/lib/backups/encryption-envelope';
import { sniffBackupUpload } from '@/lib/backups/sniff';

// v0.10.0 C2 — magic-byte sniff for uploaded backup bundles. The sniff is
// deliberately magic-only: a PGDMP-prefixed but truncated archive passes here
// and fails later in pg_restore (the restore job surfaces that stderr).

describe('sniffBackupUpload', () => {
  it('accepts a PGDMP-prefixed .dump (even truncated to just the magic)', () => {
    expect(sniffBackupUpload('a.dump', Buffer.from('PGDMP\x01\x02rest-of-archive'))).toEqual({
      ok: true,
      kind: 'dump',
    });
    expect(sniffBackupUpload('a.dump', Buffer.from('PGDMP'))).toEqual({ ok: true, kind: 'dump' });
  });

  it('rejects a .dump whose body is not a pg_dump archive', () => {
    expect(sniffBackupUpload('junk.dump', Buffer.from('hello world'))).toEqual({
      ok: false,
      reason: 'bad-magic',
    });
    expect(sniffBackupUpload('empty.dump', Buffer.alloc(0))).toEqual({
      ok: false,
      reason: 'bad-magic',
    });
  });

  it('accepts a CAIRN-ENC-BAK-v1 envelope as .dump.enc', () => {
    const header = Buffer.concat([ENVELOPE_MAGIC, Buffer.from('salt-and-nonce-bytes')]);
    expect(sniffBackupUpload('a.dump.enc', header)).toEqual({ ok: true, kind: 'dump.enc' });
  });

  it('rejects a magic/extension mismatch in both directions', () => {
    // Plaintext dump renamed to .enc: the restore CLI would try to decrypt it.
    expect(sniffBackupUpload('a.dump.enc', Buffer.from('PGDMP...'))).toEqual({
      ok: false,
      reason: 'bad-magic',
    });
    // Envelope renamed to plain .dump: pg_restore would read ciphertext.
    expect(sniffBackupUpload('a.dump', ENVELOPE_MAGIC)).toEqual({
      ok: false,
      reason: 'bad-magic',
    });
  });

  it('rejects unsupported extensions regardless of content', () => {
    expect(sniffBackupUpload('uploads.tar.gz', Buffer.from('PGDMP'))).toEqual({
      ok: false,
      reason: 'bad-extension',
    });
    expect(sniffBackupUpload('notes.txt', Buffer.from('PGDMP'))).toEqual({
      ok: false,
      reason: 'bad-extension',
    });
  });
});
