import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup } from '@/lib/backups/encryption';

// v0.9.0 G8 P43 — file-level roundtrip that mirrors what the backup CLI does
// after pg_dump finishes (encrypt the .dump file in place via the Transform
// stream). Asserts the on-disk artefact carries the CAIRN-ENC-BAK envelope and
// decrypts back to byte-for-byte identical content.

describe('encrypted backup roundtrip (file-level)', () => {
  it('produces a file with the CAIRN-ENC-BAK-v1 magic and roundtrips', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-bk-'));
    const plainPath = join(dir, 'plain.dump');
    const encPath = join(dir, 'plain.dump.enc');
    const restorePath = join(dir, 'restored.dump');

    // Fake "dump" payload — for the test we just need bytes.
    const payload = Buffer.alloc(1024 * 50, 0xab);
    await writeFile(plainPath, payload);

    await pipeline(
      createReadStream(plainPath),
      encryptBackup('test-pass-123'),
      createWriteStream(encPath),
    );

    const head = (await readFile(encPath)).subarray(0, 16).toString('utf8');
    expect(head).toBe('CAIRN-ENC-BAK-v1');

    await pipeline(
      createReadStream(encPath),
      decryptBackup('test-pass-123'),
      createWriteStream(restorePath),
    );

    expect((await readFile(restorePath)).equals(payload)).toBe(true);
  });
});
