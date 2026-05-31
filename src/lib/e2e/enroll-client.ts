import { generateUserKeypair } from '@/lib/e2e/crypto';

/**
 * v0.9.7 G21 (#168) — client-side E2E enrollment.
 *
 * `enrollKeypair` generates an X25519 keypair, seals the private key under a
 * passphrase-derived KEK (all in-browser via node:crypto, polyfilled by
 * Next 16), persists ONLY the sealed material to the server, and caches the
 * sealed blob in localStorage for later unlock. The passphrase and unsealed
 * private key never leave the client.
 *
 * `ensureEnrolled` is the guard the encrypt surfaces call first: it confirms a
 * usable sealed blob is on this device, prompting enrollment when absent. When
 * the server has a row but this device lacks the blob, recovery requires the
 * original passphrase + blob (which we cannot reconstruct), so it reports
 * 'local-blob-missing' rather than silently minting a NEW key (which would
 * strand every prior wrap).
 */

export const SEALED_KEY = 'cairn.e2e.sealedKeypair';

export type StoredSealed = {
  publicKey: string;
  encryptedPrivateKey: string;
  kdfSalt: string;
  kdfIters: number;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type EnsureResult =
  | { enrolled: true; stored: StoredSealed }
  | { enrolled: false; reason: 'never-enrolled' | 'local-blob-missing' };

type FetchLike = typeof fetch;

function readStored(storage: StorageLike): StoredSealed | null {
  const raw = storage.getItem(SEALED_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSealed;
    if (
      typeof parsed.publicKey === 'string' &&
      typeof parsed.encryptedPrivateKey === 'string' &&
      typeof parsed.kdfSalt === 'string' &&
      typeof parsed.kdfIters === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function resolveStorage(provided?: StorageLike): StorageLike | undefined {
  if (provided) return provided;
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

/**
 * Generate + seal + persist + cache. Returns the public key (base64) on
 * success. Throws (leaving localStorage untouched) if the server rejects the
 * enrollment, so a rejected enrollment never leaves a blob the roster won't
 * match.
 */
export async function enrollKeypair(
  passphrase: string,
  deps: { fetch?: FetchLike; storage?: StorageLike } = {},
): Promise<{ publicKey: string }> {
  const doFetch = deps.fetch ?? fetch;
  const storage = resolveStorage(deps.storage);
  if (!storage) throw new Error('no storage available');

  const sealed = await generateUserKeypair(passphrase);
  const stored: StoredSealed = {
    publicKey: sealed.publicKey.toString('base64'),
    encryptedPrivateKey: sealed.encryptedPrivateKey.toString('base64'),
    kdfSalt: sealed.kdfSalt.toString('base64'),
    kdfIters: sealed.kdfIters,
  };

  const res = await doFetch('/api/users/me/keypair', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(stored),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `enrollment failed: ${res.status}`);
  }
  // Persist locally ONLY after the server accepted the public key.
  storage.setItem(SEALED_KEY, JSON.stringify(stored));
  return { publicKey: stored.publicKey };
}

/**
 * Confirm a usable sealed blob exists on this device.
 */
export async function ensureEnrolled(
  deps: { fetch?: FetchLike; storage?: StorageLike } = {},
): Promise<EnsureResult> {
  const doFetch = deps.fetch ?? fetch;
  const storage = resolveStorage(deps.storage);
  if (!storage) return { enrolled: false, reason: 'never-enrolled' };

  const local = readStored(storage);
  if (local) return { enrolled: true, stored: local };

  const res = await doFetch('/api/users/me/keypair');
  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { enrolled?: boolean };
    if (body.enrolled) return { enrolled: false, reason: 'local-blob-missing' };
  }
  return { enrolled: false, reason: 'never-enrolled' };
}
