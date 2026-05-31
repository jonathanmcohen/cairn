import { generateDek, unlockUserKeypair, unwrapDek, wrapDek } from '@/lib/e2e/crypto';
import type { StoredSealed } from '@/lib/e2e/enroll-client';
import { decryptPageContent, encryptPageContent } from '@/lib/e2e/page-cipher';

/**
 * v0.9.7 G21 (#168) — client-side workspace rekey / member removal.
 *
 * Forward secrecy on member churn: mint a NEW workspace key (WSK), wrap it
 * ONLY for the remaining roster, re-encrypt every encrypted page under the new
 * WSK, and POST the wrapped roster + ciphertext bundles to /rekey. The removed
 * member's still-cached OLD WSK cannot decrypt the new ciphertext.
 *
 * The server never sees the old WSK, the new WSK, or any plaintext. Every
 * unwrap / mint / wrap / decrypt / re-encrypt step happens here in the browser.
 *
 * Endpoints (all owner/viewer-gated server-side):
 *   GET  /api/workspaces/[id]/e2e/my-wsk          → caller's wrapped WSK
 *   GET  /api/workspaces/[id]/keypair-roster      → member public keys
 *   GET  /api/workspaces/[id]/e2e/encrypted-pages → [{pageId, contentEncrypted}]
 *   POST /api/workspaces/[id]/e2e/rekey           → persist new roster + bundles
 */

type FetchLike = typeof fetch;

export type RekeyDeps = {
  workspaceId: string;
  passphrase: string;
  sealed: StoredSealed; // caller's local sealed keypair
  removedMemberId: string | null;
  fetch?: FetchLike;
  onProgress?: (done: number, total: number) => void;
};

export type RekeyResult = { keyVersion: number };

type RosterRow = { memberUserId: string; publicKey: string };
type EncryptedPage = { pageId: string; contentEncrypted: string };

export async function runRekey(deps: RekeyDeps): Promise<RekeyResult> {
  const doFetch = deps.fetch ?? fetch;
  const base = `/api/workspaces/${deps.workspaceId}`;

  // 1. Unlock the caller's keypair (in-memory only).
  const me = await unlockUserKeypair(
    {
      publicKey: Buffer.from(deps.sealed.publicKey, 'base64'),
      encryptedPrivateKey: Buffer.from(deps.sealed.encryptedPrivateKey, 'base64'),
      kdfSalt: Buffer.from(deps.sealed.kdfSalt, 'base64'),
      kdfIters: deps.sealed.kdfIters,
    },
    deps.passphrase,
  );

  // 2. Recover the CURRENT WSK from the caller's own wrapped row.
  const myWskRes = await doFetch(`${base}/e2e/my-wsk`);
  if (!myWskRes.ok) throw new Error(`my-wsk fetch failed: ${myWskRes.status}`);
  const myWsk = (await myWskRes.json()) as { wrappedWsk: string; keyVersion: number };
  const oldWsk = unwrapDek(Buffer.from(myWsk.wrappedWsk, 'base64'), me.privateKey);

  // 3. Roster public keys; drop the removed member.
  const rosterRes = await doFetch(`${base}/keypair-roster`);
  if (!rosterRes.ok) throw new Error(`roster fetch failed: ${rosterRes.status}`);
  const roster = (await rosterRes.json()) as RosterRow[];
  const remaining = roster.filter((r) => r.memberUserId !== deps.removedMemberId);
  if (remaining.length === 0) throw new Error('rekey would leave no members');

  // 4. Mint a fresh WSK and wrap it for every remaining member.
  const newWsk = generateDek();
  const wrapped = remaining.map((r) => ({
    memberUserId: r.memberUserId,
    wrappedWsk: Buffer.from(wrapDek(newWsk, Buffer.from(r.publicKey, 'base64'))).toString('base64'),
  }));

  // 5. Re-encrypt every encrypted page: decrypt with the OLD WSK, re-encrypt
  //    with the NEW WSK.
  const pagesRes = await doFetch(`${base}/e2e/encrypted-pages`);
  if (!pagesRes.ok) throw new Error(`encrypted-pages fetch failed: ${pagesRes.status}`);
  const pages = (await pagesRes.json()) as EncryptedPage[];
  const total = pages.length;
  const pageBundles: EncryptedPage[] = [];
  let done = 0;
  for (const p of pages) {
    const plain = decryptPageContent(Buffer.from(p.contentEncrypted, 'base64'), oldWsk);
    const reCt = encryptPageContent(plain, newWsk);
    pageBundles.push({ pageId: p.pageId, contentEncrypted: reCt.toString('base64') });
    done += 1;
    deps.onProgress?.(done, total);
  }

  // 6. Persist the new roster + ciphertext bundles.
  const res = await doFetch(`${base}/e2e/rekey`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wrapped, pageBundles, removedMemberId: deps.removedMemberId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `rekey failed: ${res.status}`);
  }
  const out = (await res.json()) as { keyVersion: number };
  return { keyVersion: out.keyVersion };
}
