import { describe, expect, it, vi } from 'vitest';
import { unlockUserKeypair } from '@/lib/e2e/crypto';
import {
  enrollKeypair,
  ensureEnrolled,
  SEALED_KEY,
  type StorageLike,
  type StoredSealed,
} from '@/lib/e2e/enroll-client';

function makeStorage(): { storage: StorageLike; store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    },
  };
}

function okFetch(body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status: 200 }),
  ) as unknown as typeof fetch;
}

describe('enrollKeypair', () => {
  it('generates, PUTs, and caches a sealed blob whose lengths round-trip', async () => {
    const { storage, store } = makeStorage();
    const fetchImpl = okFetch({ ok: true });
    const { publicKey } = await enrollKeypair('correct horse', { fetch: fetchImpl, storage });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const raw = store.get(SEALED_KEY);
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw as string) as StoredSealed;
    expect(Buffer.from(stored.publicKey, 'base64').byteLength).toBe(32);
    expect(Buffer.from(stored.encryptedPrivateKey, 'base64').byteLength).toBe(60);
    expect(Buffer.from(stored.kdfSalt, 'base64').byteLength).toBe(16);
    expect(typeof stored.kdfIters).toBe('number');
    expect(stored.publicKey).toBe(publicKey);
  });

  it('crypto round-trip: stored blob unlocks with the same passphrase and recovers the public key', async () => {
    const { storage, store } = makeStorage();
    const { publicKey } = await enrollKeypair('s3cret', { fetch: okFetch({ ok: true }), storage });
    const stored = JSON.parse(store.get(SEALED_KEY) as string) as StoredSealed;

    const unlocked = await unlockUserKeypair(
      {
        publicKey: Buffer.from(stored.publicKey, 'base64'),
        encryptedPrivateKey: Buffer.from(stored.encryptedPrivateKey, 'base64'),
        kdfSalt: Buffer.from(stored.kdfSalt, 'base64'),
        kdfIters: stored.kdfIters,
      },
      's3cret',
    );
    expect(unlocked.publicKey.toString('base64')).toBe(publicKey);
    expect(unlocked.privateKey.byteLength).toBe(32);
  });

  it('wrong passphrase fails to unlock the stored blob', async () => {
    const { storage, store } = makeStorage();
    await enrollKeypair('right', { fetch: okFetch({ ok: true }), storage });
    const stored = JSON.parse(store.get(SEALED_KEY) as string) as StoredSealed;
    await expect(
      unlockUserKeypair(
        {
          publicKey: Buffer.from(stored.publicKey, 'base64'),
          encryptedPrivateKey: Buffer.from(stored.encryptedPrivateKey, 'base64'),
          kdfSalt: Buffer.from(stored.kdfSalt, 'base64'),
          kdfIters: stored.kdfIters,
        },
        'wrong',
      ),
    ).rejects.toThrow();
  });

  it('throws and leaves storage untouched when the PUT fails (409)', async () => {
    const { storage, store } = makeStorage();
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }),
    ) as unknown as typeof fetch;
    await expect(enrollKeypair('pw', { fetch: fetchImpl, storage })).rejects.toThrow(/conflict/);
    expect(store.get(SEALED_KEY)).toBeUndefined();
  });
});

describe('ensureEnrolled', () => {
  it('returns enrolled:true immediately when a valid blob is present (no fetch)', async () => {
    const { storage, store } = makeStorage();
    const stored: StoredSealed = {
      publicKey: Buffer.alloc(32, 1).toString('base64'),
      encryptedPrivateKey: Buffer.alloc(60, 2).toString('base64'),
      kdfSalt: Buffer.alloc(16, 3).toString('base64'),
      kdfIters: 32768,
    };
    store.set(SEALED_KEY, JSON.stringify(stored));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await ensureEnrolled({ fetch: fetchImpl, storage });
    expect(r.enrolled).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns local-blob-missing when server has a row but local blob is absent', async () => {
    const { storage } = makeStorage();
    const fetchImpl = okFetch({ enrolled: true, publicKey: 'AAAA' });
    const r = await ensureEnrolled({ fetch: fetchImpl, storage });
    expect(r).toEqual({ enrolled: false, reason: 'local-blob-missing' });
  });

  it('returns never-enrolled when neither storage nor server has a keypair', async () => {
    const { storage } = makeStorage();
    const fetchImpl = okFetch({ enrolled: false });
    const r = await ensureEnrolled({ fetch: fetchImpl, storage });
    expect(r).toEqual({ enrolled: false, reason: 'never-enrolled' });
  });
});
