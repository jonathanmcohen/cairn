'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Sealed = {
  publicKey: string;
  encryptedPrivateKey: string;
  kdfSalt: string;
  kdfIters: number;
};

type Member = { memberUserId: string; publicKey: string };
type PageRow = { id: string; title: string };

/**
 * v0.9.0 G1 P7 — admin toggle for workspace-wide E2E encryption.
 *
 * Client Component. The server NEVER sees the workspace-key (WSK) or any
 * plaintext page content. Flow on "Enable":
 *   1. Prompt for the admin's E2E passphrase, unlock their sealed keypair
 *      (cached in localStorage by P5 enrollment).
 *   2. Fetch the workspace keypair roster (public keys only).
 *   3. Mint a fresh 32-byte WSK; wrap it once per member public key.
 *   4. POST /api/workspaces/:id/e2e/enable with the wrapped roster — the
 *      server flips e2eMode to 'workspace_wide' and inserts the WSK rows.
 *   5. Fetch every non-encrypted page id (/page-ids); for each one, fetch
 *      its current document, encrypt under the WSK, and POST to
 *      /api/pages/:id/encrypt-under-wsk. Progress shown as X / N.
 *
 * Irreversible-by-design: there is no UI path to disable workspace_wide.
 * Member removal triggers /rekey (separate admin flow); the in-memory WSK
 * is dropped at the end of this call — only members with a wrapped-WSK row
 * can re-derive it from their keypair.
 */
export function WorkspaceE2EToggle({
  workspaceId,
  initialMode,
}: {
  workspaceId: string;
  initialMode: 'off' | 'per_page' | 'workspace_wide';
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState(initialMode);

  async function enable() {
    setBusy(true);
    setErr(null);
    setProgress(null);
    try {
      // Lazy-load crypto so the toggle page doesn't pay the bundle cost for
      // admins who never click.
      const { generateDek, wrapDek, unlockUserKeypair } = await import('@/lib/e2e/crypto');
      const { encryptPageContent } = await import('@/lib/e2e/page-cipher');

      // 1. Unlock caller's keypair from the sealed local blob (P5 enrollment).
      const sealedJson =
        typeof window === 'undefined'
          ? null
          : window.localStorage.getItem('cairn.e2e.sealedKeypair');
      if (!sealedJson) {
        throw new Error('no sealed keypair on this device — enroll your passphrase first');
      }
      const sealed = JSON.parse(sealedJson) as Sealed;
      const passphrase = window.prompt(
        'Enter your E2E passphrase to enable workspace-wide encryption',
      );
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

      // 2. Fetch member roster (public keys only).
      const rosterRes = await fetch(`/api/workspaces/${workspaceId}/keypair-roster`);
      if (!rosterRes.ok) throw new Error('roster fetch failed');
      const roster: Member[] = await rosterRes.json();
      if (roster.length === 0) {
        throw new Error('no workspace members have enrolled keypairs');
      }
      // Sanity: caller's public key must appear in the roster.
      if (!roster.some((r) => Buffer.from(r.publicKey, 'base64').equals(me.publicKey))) {
        throw new Error('unlocked key does not match server-side roster');
      }

      // 3. Mint WSK + wrap for every member.
      const wsk = generateDek();
      const wrapped = roster.map((m) => ({
        memberUserId: m.memberUserId,
        wrappedWsk: Buffer.from(wrapDek(wsk, Buffer.from(m.publicKey, 'base64'))).toString(
          'base64',
        ),
      }));

      // 4. Enable.
      const enableRes = await fetch(`/api/workspaces/${workspaceId}/e2e/enable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wrapped }),
      });
      if (!enableRes.ok) {
        const body = (await enableRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `enable failed: ${enableRes.status}`);
      }
      setMode('workspace_wide');

      // 5. Sweep every page. page-ids is cursor-paginated (id ASC); follow
      // nextCursor until the server reports no more rows.
      const pageRows: PageRow[] = [];
      let cursor: string | null = null;
      do {
        const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const pageRes = await fetch(`/api/workspaces/${workspaceId}/page-ids${qs}`);
        if (!pageRes.ok) throw new Error('page-ids fetch failed');
        const body = (await pageRes.json()) as {
          rows: PageRow[];
          nextCursor: string | null;
        };
        pageRows.push(...body.rows);
        cursor = body.nextCursor;
      } while (cursor);
      setProgress({ done: 0, total: pageRows.length });
      for (let i = 0; i < pageRows.length; i++) {
        const id = pageRows[i]?.id;
        if (!id) continue;
        const docRes = await fetch(`/api/pages/${id}`);
        if (!docRes.ok) throw new Error(`page fetch failed at ${id}: ${docRes.status}`);
        const doc = (await docRes.json()) as { content?: unknown };
        const ct = encryptPageContent(doc.content ?? { type: 'doc', content: [] }, wsk);
        const r = await fetch(`/api/pages/${id}/encrypt-under-wsk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contentEncrypted: ct.toString('base64') }),
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `sweep failed at page ${id}: ${r.status}`);
        }
        setProgress({ done: i + 1, total: pageRows.length });
      }
    } catch (e) {
      // Never `console.error(e)` — error message could be derived from a key.
      // Surface a sanitized message to the operator.
      setErr(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'workspace_wide') {
    return (
      <div className="space-y-2">
        <p className="font-medium text-sm">
          Workspace-wide encryption is enabled. All pages are stored as ciphertext.
        </p>
        <p className="text-xs text-muted-foreground">
          To remove a member or rotate the workspace key, use the rekey flow (separate action).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={enable} disabled={busy}>
        {busy ? 'Encrypting workspace…' : 'Enable workspace-wide encryption'}
      </Button>
      {progress ? (
        <p className="text-sm">
          Encrypted {progress.done} / {progress.total} pages
        </p>
      ) : null}
      {err ? <p className="text-destructive text-sm">{err}</p> : null}
      <p className="text-muted-foreground text-xs">
        This action cannot be undone in v0.9. Once enabled, every existing page is encrypted under a
        workspace key that the server never sees. To rotate the key or remove a member, use the
        rekey flow.
      </p>
    </div>
  );
}
