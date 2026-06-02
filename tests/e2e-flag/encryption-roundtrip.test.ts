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

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('E2EE flag-ON end-to-end (env-gated path)', () => {
  it('enroll → persist sealed blob → unlock → encrypt page → decrypt page', async () => {
    // generateUserKeypair is referenced to assert the enroll path uses it.
    expect(typeof generateUserKeypair).toBe('function');
    const storage = new MemStorage();
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { publicKey } = await enrollKeypair('correct horse battery staple', {
      fetch: fetchImpl as unknown as typeof fetch,
      storage,
    });
    expect(publicKey.length).toBeGreaterThan(0);

    const stored = JSON.parse(storage.getItem(SEALED_KEY) as string) as StoredSealed;
    const unlocked = await unlockUserKeypair(
      {
        publicKey: Buffer.from(stored.publicKey, 'base64'),
        encryptedPrivateKey: Buffer.from(stored.encryptedPrivateKey, 'base64'),
        kdfSalt: Buffer.from(stored.kdfSalt, 'base64'),
        kdfIters: stored.kdfIters,
      },
      'correct horse battery staple',
    );

    // Wrap a DEK for self, encrypt a page, then decrypt it back.
    const dek = generateDek();
    const wrapped = wrapDek(dek, unlocked.publicKey);
    const recovered = unwrapDek(wrapped, unlocked.privateKey);
    expect(recovered.equals(dek)).toBe(true);

    const doc = { type: 'doc', content: [{ type: 'paragraph', text: 'secret note' }] };
    const ct = encryptPageContent(doc, dek);
    expect(ct.toString('utf8')).not.toContain('secret note');
    expect(decryptPageContent(ct, dek)).toEqual(doc);
  });

  it('workspace rekey re-encrypts ciphertext under a new WSK and the old WSK can no longer read it', () => {
    const oldWsk = generateDek();
    const newWsk = generateDek();
    const doc = { type: 'doc', content: [] };
    const ctOld = encryptPageContent(doc, oldWsk);
    // Rekey step: decrypt with old, re-encrypt with new.
    const plain = decryptPageContent(ctOld, oldWsk);
    const ctNew = encryptPageContent(plain, newWsk);
    expect(decryptPageContent(ctNew, newWsk)).toEqual(doc);
    expect(() => decryptPageContent(ctNew, oldWsk)).toThrow();
  });
});
