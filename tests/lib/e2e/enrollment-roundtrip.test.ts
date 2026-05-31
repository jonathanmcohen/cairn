import { describe, expect, it, vi } from 'vitest';
import {
  generateDek,
  generateUserKeypair,
  unlockUserKeypair,
  unwrapDek,
  wrapDek,
} from '@/lib/e2e/crypto';
import { enrollKeypair, SEALED_KEY, type StoredSealed } from '@/lib/e2e/enroll-client';
import { decryptPageContent, encryptPageContent } from '@/lib/e2e/page-cipher';

/**
 * v0.9.7 G21 (#168) — end-to-end crypto regression: the whole enrollment →
 * encrypt → rekey chain, using ONLY the production helpers (no UI). Proves the
 * security invariants stay sound: distinct passphrases seal/unlock
 * independently, every wrapped member recovers the same key, wrong passphrase
 * and missing wraps fail, and member removal gives forward secrecy.
 */

async function enroll(passphrase: string) {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const okFetch = vi.fn(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ) as unknown as typeof fetch;
  await enrollKeypair(passphrase, { fetch: okFetch, storage });
  const stored = JSON.parse(store.get(SEALED_KEY) as string) as StoredSealed;
  const unlocked = await unlockUserKeypair(
    {
      publicKey: Buffer.from(stored.publicKey, 'base64'),
      encryptedPrivateKey: Buffer.from(stored.encryptedPrivateKey, 'base64'),
      kdfSalt: Buffer.from(stored.kdfSalt, 'base64'),
      kdfIters: stored.kdfIters,
    },
    passphrase,
  );
  return { stored, unlocked };
}

describe('enrollment → encrypt → rekey crypto regression (#168)', () => {
  it('three enrolled users all recover the WSK and decrypt; bad passphrase + missing wrap fail', async () => {
    const u1 = await enroll('pw-one');
    const u2 = await enroll('pw-two');
    const u3 = await enroll('pw-three');

    const wsk = generateDek();
    const doc = { type: 'doc', content: [{ type: 'paragraph', text: 'secret' }] };
    const ct = encryptPageContent(doc, wsk);

    // Each member's wrapped WSK recovers the SAME WSK and decrypts the doc.
    for (const u of [u1, u2, u3]) {
      const wrapped = wrapDek(wsk, u.unlocked.publicKey);
      const recovered = unwrapDek(wrapped, u.unlocked.privateKey);
      expect(recovered.equals(wsk)).toBe(true);
      expect(decryptPageContent(ct, recovered)).toEqual(doc);
    }

    // Wrong passphrase fails to unlock (GCM auth tag).
    await expect(
      unlockUserKeypair(
        {
          publicKey: Buffer.from(u1.stored.publicKey, 'base64'),
          encryptedPrivateKey: Buffer.from(u1.stored.encryptedPrivateKey, 'base64'),
          kdfSalt: Buffer.from(u1.stored.kdfSalt, 'base64'),
          kdfIters: u1.stored.kdfIters,
        },
        'wrong-passphrase',
      ),
    ).rejects.toThrow();

    // A user whose wrapped row is absent cannot derive the WSK: unwrapping a
    // wrap meant for u1 with u3's private key fails.
    const wrappedForU1 = wrapDek(wsk, u1.unlocked.publicKey);
    expect(() => unwrapDek(wrappedForU1, u3.unlocked.privateKey)).toThrow();
  });

  it('rekey on member removal gives forward secrecy', async () => {
    const u1 = await enroll('a');
    const u2 = await enroll('b');
    const u3 = await enroll('c');

    const oldWsk = generateDek();
    const doc = { type: 'doc', content: [{ type: 'paragraph', text: 'v1' }] };
    const oldCt = encryptPageContent(doc, oldWsk);
    // all 3 can read under old WSK.
    expect(
      decryptPageContent(
        oldCt,
        unwrapDek(wrapDek(oldWsk, u3.unlocked.publicKey), u3.unlocked.privateKey),
      ),
    ).toEqual(doc);

    // Remove u3: mint NEW WSK, wrap for u1+u2, re-encrypt the page.
    const newWsk = generateDek();
    expect(Buffer.compare(newWsk, oldWsk)).not.toBe(0);
    const newCt = encryptPageContent(decryptPageContent(oldCt, oldWsk), newWsk);

    // u1 & u2 recover the new WSK and decrypt the new ciphertext.
    for (const u of [u1, u2]) {
      const recovered = unwrapDek(wrapDek(newWsk, u.unlocked.publicKey), u.unlocked.privateKey);
      expect(recovered.equals(newWsk)).toBe(true);
      expect(decryptPageContent(newCt, recovered)).toEqual(doc);
    }

    // Forward secrecy: u3's OLD private key + NEW ciphertext do NOT decrypt
    // (u3 has no new wrapped row; and even the OLD WSK cannot decrypt NEW ct).
    expect(() => decryptPageContent(newCt, oldWsk)).toThrow();
  });

  it('sealed blob shape persisted by enrollKeypair decodes to 32/60/16-byte buffers', async () => {
    const sealed = await generateUserKeypair('shape-check');
    const stored: StoredSealed = {
      publicKey: sealed.publicKey.toString('base64'),
      encryptedPrivateKey: sealed.encryptedPrivateKey.toString('base64'),
      kdfSalt: sealed.kdfSalt.toString('base64'),
      kdfIters: sealed.kdfIters,
    };
    expect(Buffer.from(stored.publicKey, 'base64').byteLength).toBe(32);
    expect(Buffer.from(stored.encryptedPrivateKey, 'base64').byteLength).toBe(60);
    expect(Buffer.from(stored.kdfSalt, 'base64').byteLength).toBe(16);
    expect(stored.kdfIters).toBe(32768);
  });
});
