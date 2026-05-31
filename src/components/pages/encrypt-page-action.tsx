'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePrompt } from '@/components/ui/input-dialog';
import { enrollKeypair, ensureEnrolled, SEALED_KEY } from '@/lib/e2e/enroll-client';
import { useT } from '@/lib/i18n/provider';

type Sealed = {
  publicKey: string;
  encryptedPrivateKey: string;
  kdfSalt: string;
  kdfIters: number;
};

/**
 * v0.9.0 G1 P6 / v0.9.7 G21 (#168) — "Encrypt page" action surfaced in the
 * page menu when NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=true. Every
 * cryptographic step happens CLIENT-SIDE:
 *
 *   0. ensureEnrolled(): if the caller has no sealed keypair on this device,
 *      run the in-line enrollment flow (generate + seal + persist) FIRST so
 *      the action is never a dead-end. A server-side row with a missing local
 *      blob surfaces a recovery error (it cannot be re-minted without the
 *      original passphrase — doing so would strand prior wraps).
 *   1. Fetch the keypair roster (public keys of every workspace member with an
 *      enrolled keypair) from GET /api/workspaces/[id]/keypair-roster.
 *   2. Unlock the caller's private key from the sealed localStorage blob. The
 *      passphrase prompt happens here; the unlocked key lives only in memory.
 *   3. Generate a 32-byte DEK; encrypt the TipTap doc JSON; wrap the DEK once
 *      per recipient public key.
 *   4. POST ciphertext + wrapped DEK bundle to /api/pages/[pageId]/encrypt.
 *
 * The server never sees the passphrase, the DEK, or the page plaintext.
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
  const t = useT();
  const prompt = usePrompt();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ensureLocalKeypair(): Promise<boolean> {
    const result = await ensureEnrolled();
    if (result.enrolled) return true;
    if (result.reason === 'local-blob-missing') {
      setErr(t('e2e.enroll.recoveryNeeded'));
      return false;
    }
    // never-enrolled → run enrollment inline (prompt twice for confirm).
    const pass = await prompt({
      title: t('e2e.enroll.passphrasePrompt'),
      type: 'password',
      confirmLabel: t('e2e.enroll.cta'),
    });
    if (!pass) return false;
    const confirm = await prompt({
      title: t('e2e.enroll.confirmPrompt'),
      type: 'password',
      confirmLabel: t('e2e.enroll.cta'),
    });
    if (pass !== confirm) {
      setErr(t('e2e.enroll.mismatch'));
      return false;
    }
    await enrollKeypair(pass);
    return true;
  }

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      // 0. Make sure this device has a usable sealed keypair first.
      if (!(await ensureLocalKeypair())) return;

      // Lazy-load so unrelated pages don't pay the crypto bundle cost.
      const { encryptPageContent } = await import('@/lib/e2e/page-cipher');
      const { generateDek, wrapDek, unlockUserKeypair } = await import('@/lib/e2e/crypto');

      // 1. Roster (public keys only).
      const rosterRes = await fetch(`/api/workspaces/${workspaceId}/keypair-roster`);
      if (!rosterRes.ok) throw new Error(t('e2e.encryptPage.noRoster'));
      const roster = (await rosterRes.json()) as Array<{
        memberUserId: string;
        publicKey: string;
      }>;
      if (roster.length === 0) {
        throw new Error(t('e2e.encryptPage.noRoster'));
      }

      // 2. Unlock caller's keypair (the blob now exists after step 0).
      const sealedJson =
        typeof window === 'undefined' ? null : window.localStorage.getItem(SEALED_KEY);
      if (!sealedJson) {
        throw new Error(t('e2e.enroll.recoveryNeeded'));
      }
      const sealed = JSON.parse(sealedJson) as Sealed;
      const passphrase = await prompt({
        title: t('e2e.encryptPage.passphrasePrompt'),
        type: 'password',
        confirmLabel: t('e2e.encryptPage.cta'),
      });
      if (!passphrase) return;
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
        throw new Error(t('e2e.encryptPage.keyMismatch'));
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
        throw new Error(body.error ?? t('e2e.encryptPage.failed', { message: String(res.status) }));
      }
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('e2e.encryptPage.failed', { message: '' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" onClick={run} disabled={busy} variant="ghost" size="sm">
        {busy ? t('e2e.encryptPage.busy') : t('e2e.encryptPage.cta')}
      </Button>
      {err ? <p className="text-destructive text-xs">{err}</p> : null}
    </div>
  );
}
