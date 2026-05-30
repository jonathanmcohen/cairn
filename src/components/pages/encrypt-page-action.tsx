'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePrompt } from '@/components/ui/input-dialog';

type Sealed = {
  publicKey: string;
  encryptedPrivateKey: string;
  kdfSalt: string;
  kdfIters: number;
};

/**
 * v0.9.0 G1 P6 — "Encrypt page" action surfaced in the page menu when the
 * server-side build inlines NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=true.
 * Every cryptographic step happens CLIENT-SIDE:
 *
 *   1. Fetch the keypair roster (public keys of every workspace member with
 *      an enrolled keypair) from
 *      GET /api/workspaces/[id]/keypair-roster.
 *   2. Unlock the caller's private key — sealed keypair is cached in
 *      localStorage at enrollment time (P5 surface). Passphrase prompt
 *      happens here; the unlocked key is held only in memory.
 *   3. Generate a 32-byte DEK; encrypt the current TipTap doc JSON with
 *      `encryptPageContent`; wrap the DEK once per recipient public key.
 *   4. POST ciphertext + wrapped DEK bundle to
 *      /api/pages/[pageId]/encrypt. The server writes ciphertext +
 *      content_text='' + content=sentinel + per-member wrapped DEKs in a
 *      single transaction.
 *
 * The crypto helpers (`generateDek`, `wrapDek`, `unlockUserKeypair`,
 * `encryptPageContent`) use `node:crypto` which Next 16 polyfills at the
 * client bundle layer.
 */
export function EncryptPageAction({
  pageId,
  workspaceId,
  currentDoc,
}: {
  pageId: string;
  workspaceId: string;
  currentDoc: unknown;
}) {
  const prompt = usePrompt();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      // Lazy-load so unrelated pages don't pay the crypto bundle cost.
      const { encryptPageContent } = await import('@/lib/e2e/page-cipher');
      const { generateDek, wrapDek, unlockUserKeypair } = await import('@/lib/e2e/crypto');

      // 1. Roster (public keys only).
      const rosterRes = await fetch(`/api/workspaces/${workspaceId}/keypair-roster`);
      if (!rosterRes.ok) throw new Error('roster fetch failed');
      const roster = (await rosterRes.json()) as Array<{
        memberUserId: string;
        publicKey: string;
      }>;
      if (roster.length === 0) {
        throw new Error('no workspace members have enrolled keypairs');
      }

      // 2. Unlock caller's keypair.
      const sealedJson =
        typeof window === 'undefined'
          ? null
          : window.localStorage.getItem('cairn.e2e.sealedKeypair');
      if (!sealedJson) {
        throw new Error('no sealed keypair on this device — enroll your passphrase first');
      }
      const sealed = JSON.parse(sealedJson) as Sealed;
      const passphrase = await prompt({
        title: 'Enter your E2E passphrase to encrypt this page',
        type: 'password',
        confirmLabel: 'Encrypt',
      });
      if (!passphrase) throw new Error('cancelled');
      const me = await unlockUserKeypair(
        {
          publicKey: Buffer.from(sealed.publicKey, 'base64'),
          encryptedPrivateKey: Buffer.from(sealed.encryptedPrivateKey, 'base64'),
          kdfSalt: Buffer.from(sealed.kdfSalt, 'base64'),
          kdfIters: sealed.kdfIters,
        },
        passphrase,
      );
      // Sanity: the unlocked public key must match the one on file in the
      // roster for this user (defense against a swapped localStorage blob).
      const myRosterRow = roster.find((r) =>
        Buffer.from(r.publicKey, 'base64').equals(me.publicKey),
      );
      if (!myRosterRow) {
        throw new Error('unlocked key does not match server-side roster');
      }

      // 3. Generate DEK, encrypt content, wrap DEK per recipient.
      const dek = generateDek();
      const ct = encryptPageContent(currentDoc, dek);
      const wrappedDeks = roster.map((r) => ({
        memberUserId: r.memberUserId,
        wrappedDek: Buffer.from(wrapDek(dek, Buffer.from(r.publicKey, 'base64'))).toString(
          'base64',
        ),
      }));

      // 4. POST to /encrypt route.
      const res = await fetch(`/api/pages/${pageId}/encrypt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contentEncrypted: ct.toString('base64'),
          wrappedDeks,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `encrypt failed: ${res.status}`);
      }
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" onClick={run} disabled={busy} variant="ghost" size="sm">
        {busy ? 'Encrypting…' : 'Encrypt page'}
      </Button>
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
    </div>
  );
}
