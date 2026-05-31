'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { usePrompt } from '@/components/ui/input-dialog';
import { enrollKeypair, ensureEnrolled, type StoredSealed } from '@/lib/e2e/enroll-client';
import { useT } from '@/lib/i18n/provider';

type Member = { memberUserId: string; publicKey: string };
type PageRow = { id: string; title: string };

/**
 * v0.9.0 G1 P7 / v0.9.7 G21 (#168) — admin toggle for workspace-wide E2E.
 *
 * Client Component. The server NEVER sees the workspace-key (WSK) or any
 * plaintext page content. Flow on "Enable":
 *   0. ensureEnrolled(): if the admin has no sealed keypair on this device,
 *      run inline enrollment FIRST so the toggle is never a dead-end. A
 *      server-side row with a missing local blob surfaces a recovery error.
 *   1. Prompt for the admin's passphrase, unlock their sealed keypair.
 *   2. Fetch the workspace keypair roster (public keys only).
 *   3. Mint a fresh 32-byte WSK; wrap it once per member public key.
 *   4. POST /api/workspaces/:id/e2e/enable with the wrapped roster.
 *   5. Sweep every non-encrypted page; encrypt under the WSK; POST to
 *      /api/pages/:id/encrypt-under-wsk. Progress shown as X / N.
 *
 * Irreversible-by-design: there is no UI path to disable workspace_wide.
 * Member removal triggers /rekey (separate admin flow); the in-memory WSK
 * is dropped at the end of this call.
 */
export function WorkspaceE2EToggle({
  workspaceId,
  initialMode,
}: {
  workspaceId: string;
  initialMode: 'off' | 'per_page' | 'workspace_wide';
}) {
  const prompt = usePrompt();
  const confirm = useConfirm();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState(initialMode);

  /**
   * Returns the sealed blob to unlock against, or null when the caller should
   * abort (cancelled / mismatch / recovery-needed). Returns the blob directly
   * (rather than re-reading localStorage) so a freshly-enrolled blob is used
   * even if the storage read in jsdom/SSR contexts lags.
   */
  async function ensureLocalKeypair(): Promise<StoredSealed | null> {
    const result = await ensureEnrolled();
    if (result.enrolled) return result.stored;
    if (result.reason === 'local-blob-missing') {
      setErr(t('e2e.enroll.recoveryNeeded'));
      return null;
    }
    const pass = await prompt({
      title: t('e2e.enroll.passphrasePrompt'),
      type: 'password',
      confirmLabel: t('e2e.enroll.cta'),
    });
    if (!pass) return null;
    const confirmPass = await prompt({
      title: t('e2e.enroll.confirmPrompt'),
      type: 'password',
      confirmLabel: t('e2e.enroll.cta'),
    });
    if (pass !== confirmPass) {
      setErr(t('e2e.enroll.mismatch'));
      return null;
    }
    await enrollKeypair(pass);
    const after = await ensureEnrolled();
    return after.enrolled ? after.stored : null;
  }

  async function enable() {
    const ok = await confirm({
      title: t('admin.e2e.confirmTitle'),
      description: t('admin.e2e.confirmBody'),
      confirmLabel: t('admin.e2e.confirmCta'),
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    setProgress(null);
    try {
      // 0. Make sure this device has a usable sealed keypair first.
      const sealed = await ensureLocalKeypair();
      if (!sealed) return;

      // Lazy-load crypto so the toggle page doesn't pay the bundle cost for
      // admins who never click.
      const { generateDek, wrapDek, unlockUserKeypair } = await import('@/lib/e2e/crypto');
      const { encryptPageContent } = await import('@/lib/e2e/page-cipher');

      // 1. Unlock caller's keypair from the sealed blob.
      const passphrase = await prompt({
        title: t('e2e.workspaceToggle.passphrasePrompt'),
        type: 'password',
        confirmLabel: t('e2e.workspaceToggle.cta'),
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

      // 2. Fetch member roster (public keys only).
      const rosterRes = await fetch(`/api/workspaces/${workspaceId}/keypair-roster`);
      if (!rosterRes.ok) throw new Error(t('e2e.workspaceToggle.noRoster'));
      const roster: Member[] = await rosterRes.json();
      if (roster.length === 0) {
        throw new Error(t('e2e.workspaceToggle.noRoster'));
      }
      // Sanity: caller's public key must appear in the roster.
      if (!roster.some((r) => Buffer.from(r.publicKey, 'base64').equals(me.publicKey))) {
        throw new Error(t('e2e.workspaceToggle.keyMismatch'));
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
        throw new Error(body.error ?? t('e2e.workspaceToggle.noRoster'));
      }
      setMode('workspace_wide');

      // 5. Sweep every page. page-ids is cursor-paginated (id ASC); follow
      // nextCursor until the server reports no more rows.
      const pageRows: PageRow[] = [];
      let cursor: string | null = null;
      do {
        const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const pageRes = await fetch(`/api/workspaces/${workspaceId}/page-ids${qs}`);
        if (!pageRes.ok) throw new Error(t('e2e.workspaceToggle.noRoster'));
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
        if (!docRes.ok) throw new Error(t('e2e.workspaceToggle.noRoster'));
        const doc = (await docRes.json()) as { content?: unknown };
        const ct = encryptPageContent(doc.content ?? { type: 'doc', content: [] }, wsk);
        const r = await fetch(`/api/pages/${id}/encrypt-under-wsk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contentEncrypted: ct.toString('base64') }),
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? t('e2e.workspaceToggle.noRoster'));
        }
        setProgress({ done: i + 1, total: pageRows.length });
      }
    } catch (e) {
      // Never `console.error(e)` — error message could be derived from a key.
      // Surface a sanitized message to the operator.
      setErr(e instanceof Error ? e.message : t('e2e.workspaceToggle.noRoster'));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'workspace_wide') {
    return (
      <div className="space-y-2">
        <p className="font-medium text-sm">{t('e2e.workspaceToggle.enabled')}</p>
        <p className="text-muted-foreground text-xs">{t('e2e.workspaceToggle.enabledHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={enable} disabled={busy}>
        {busy ? t('e2e.workspaceToggle.busy') : t('e2e.workspaceToggle.cta')}
      </Button>
      {progress ? (
        <p className="text-sm">
          {t('e2e.workspaceToggle.progress', { done: progress.done, total: progress.total })}
        </p>
      ) : null}
      {err ? <p className="text-destructive text-sm">{err}</p> : null}
      <p className="text-muted-foreground text-xs">{t('e2e.workspaceToggle.warning')}</p>
    </div>
  );
}
