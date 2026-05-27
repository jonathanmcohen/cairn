'use client';

import { useState } from 'react';

type SharePanelProps = {
  pageId: string;
  initialAllowDuplication?: boolean;
  initialHasPassword?: boolean;
  initialExpiresAt?: string | null;
};

/**
 * Per-page share settings: duplication toggle, link password (set/clear), and an
 * optional expiry date. Every change PATCHes `/api/pages/<pageId>/share`.
 * Mounted inside the published branch of PageMenu.
 */
export function SharePanel({
  pageId,
  initialAllowDuplication = false,
  initialHasPassword = false,
  initialExpiresAt = null,
}: SharePanelProps) {
  const [allowDuplication, setAllowDuplication] = useState(initialAllowDuplication);
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState<string>(initialExpiresAt?.slice(0, 10) ?? '');
  const [status, setStatus] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/pages/${pageId}/share`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setStatus('Saved');
      setTimeout(() => setStatus(null), 1500);
      return true;
    }
    setStatus('Error');
    return false;
  }

  /**
   * v0.9.0 G6 P33 — Generate a fresh 16-char base64 password client-side, post
   * it, and copy it to the clipboard so the admin can relay it. No
   * clear-then-set round-trip: `setShareSettings` already re-hashes a new
   * string in place. The new password is shown inline if the clipboard write
   * fails (sandboxed iframe / blocked permission).
   */
  async function rotatePassword(): Promise<void> {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const next = btoa(String.fromCharCode(...bytes))
      .replace(/[+/=]/g, '')
      .slice(0, 16);
    const ok = await patch({ password: next });
    if (!ok) return;
    try {
      await navigator.clipboard.writeText(next);
      setStatus('Rotated + copied to clipboard');
    } catch {
      setStatus(`Rotated. New password: ${next}`);
    }
    setHasPassword(true);
  }

  return (
    <div className="space-y-2 px-3 py-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={allowDuplication}
          onChange={(e) => {
            const v = e.target.checked;
            setAllowDuplication(v);
            void patch({ allowDuplication: v });
          }}
        />
        <span>Allow duplication</span>
      </label>

      <div className="space-y-1">
        <div className="text-muted-foreground text-xs">Link password</div>
        {hasPassword ? (
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs underline hover:no-underline"
                onClick={() => {
                  void patch({ password: null }).then((ok) => {
                    if (ok) setHasPassword(false);
                  });
                }}
              >
                Remove password
              </button>
              <button
                type="button"
                className="text-xs underline hover:no-underline"
                aria-label="Rotate password"
                onClick={() => {
                  void rotatePassword();
                }}
              >
                Rotate password
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1">
            <input
              type="password"
              className="w-full rounded border px-2 py-1 text-xs"
              placeholder="Set a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="rounded border px-2 text-xs hover:bg-accent"
              onClick={() => {
                if (!password) return;
                void patch({ password }).then((ok) => {
                  if (ok) {
                    setHasPassword(true);
                    setPassword('');
                  }
                });
              }}
            >
              Set
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-muted-foreground text-xs">Expires</div>
        <div className="flex gap-1">
          <input
            type="date"
            className="w-full rounded border px-2 py-1 text-xs"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <button
            type="button"
            className="rounded border px-2 text-xs hover:bg-accent"
            onClick={() => {
              void patch({
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              });
            }}
          >
            Save
          </button>
        </div>
      </div>

      {status && <div className="text-muted-foreground text-xs">{status}</div>}
    </div>
  );
}
