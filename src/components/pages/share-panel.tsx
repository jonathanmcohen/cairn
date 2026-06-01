'use client';

import { useState } from 'react';
import { PageAclManager } from '@/components/pages/page-acl-manager';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useT } from '@/lib/i18n/provider';

type SharePanelProps = {
  pageId: string;
  initialAllowDuplication?: boolean;
  initialHasPassword?: boolean;
  initialExpiresAt?: string | null;
};

/**
 * Per-page share settings: duplication toggle, link password (set/clear/rotate),
 * and an optional expiry date. Every change PATCHes `/api/pages/<pageId>/share`.
 * Rendered as the roomy, labelled body of the Share modal (ShareDialog).
 */
export function SharePanel({
  pageId,
  initialAllowDuplication = false,
  initialHasPassword = false,
  initialExpiresAt = null,
}: SharePanelProps) {
  const t = useT();
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
      setStatus(t('share.status.saved'));
      setTimeout(() => setStatus(null), 1500);
      return true;
    }
    setStatus(t('share.status.error'));
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
      setStatus(t('share.status.rotatedCopied'));
    } catch {
      setStatus(t('share.status.rotatedReveal', { password: next }));
    }
    setHasPassword(true);
  }

  return (
    <div className="space-y-5">
      {/* Allow duplication */}
      <div className="flex items-start gap-3">
        <input
          id="share-allow-dup"
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={allowDuplication}
          onChange={(e) => {
            const v = e.target.checked;
            setAllowDuplication(v);
            void patch({ allowDuplication: v });
          }}
        />
        <Label htmlFor="share-allow-dup" className="font-normal">
          <span className="block font-medium">{t('share.allowDuplication.label')}</span>
          <span className="block text-muted-foreground text-xs">
            {t('share.allowDuplication.hint')}
          </span>
        </Label>
      </div>

      {/* Link password */}
      <div className="space-y-2">
        <Label htmlFor="share-password">{t('share.password.label')}</Label>
        {hasPassword ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void patch({ password: null }).then((ok) => {
                  if (ok) setHasPassword(false);
                });
              }}
            >
              {t('share.password.remove')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('share.password.rotate')}
              onClick={() => {
                void rotatePassword();
              }}
            >
              {t('share.password.rotate')}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <PasswordInput
              id="share-password"
              aria-label={t('share.password.label')}
              showLabel={t('share.password.show')}
              hideLabel={t('share.password.hide')}
              placeholder={t('share.password.placeholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="button"
              disabled={!password}
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
              {t('share.password.set')}
            </Button>
          </div>
        )}
      </div>

      {/* Expiry */}
      <div className="space-y-2">
        <div className="flex items-end gap-2">
          <DateField
            label={t('share.expires.label')}
            value={expiresAt}
            onChange={setExpiresAt}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={() => {
              void patch({
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              });
            }}
          >
            {t('share.expires.save')}
          </Button>
        </div>
      </div>

      {status && (
        <div aria-live="polite" className="text-muted-foreground text-xs">
          {status}
        </div>
      )}

      <div className="border-t pt-4">
        <PageAclManager pageId={pageId} />
      </div>
    </div>
  );
}
