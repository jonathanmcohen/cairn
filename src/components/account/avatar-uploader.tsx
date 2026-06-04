'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.slice(0, 2).map((w) => w[0] ?? '');
  return letters.join('').toUpperCase();
}

/**
 * v0.9.9 K5 #199 — avatar uploader. Uploads the image through the existing
 * multipart /api/upload pipeline (storeUpload → { signedUrl }), then PATCHes
 * the signed URL to users.avatar_url via /api/users/me. Renders the current
 * avatar (or an initials fallback) and a Remove control. No new storage path:
 * it reuses the FileStorage interface + HMAC-signed URL serving.
 */
export function AvatarUploader({
  initialAvatarUrl,
  fallbackName,
}: {
  initialAvatarUrl: string | null;
  fallbackName: string;
}) {
  const t = useT();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function patchAvatar(next: string | null): Promise<boolean> {
    const res = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ avatarUrl: next }),
    });
    return res.ok;
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(false);
    try {
      const form = new FormData();
      form.append('file', file);
      const up = await fetch('/api/upload', { method: 'POST', body: form });
      if (!up.ok) {
        setError(true);
        return;
      }
      const { signedUrl } = (await up.json()) as { signedUrl: string };
      if (!(await patchAvatar(signedUrl))) {
        setError(true);
        return;
      }
      setAvatarUrl(signedUrl);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function onRemove() {
    setBusy(true);
    setError(false);
    try {
      if (!(await patchAvatar(null))) {
        setError(true);
        return;
      }
      setAvatarUrl(null);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-4">
      {avatarUrl ? (
        // biome-ignore lint/performance/noImgElement: signed file URL, not a static asset
        <img
          src={avatarUrl}
          alt=""
          className="h-16 w-16 rounded-full object-cover"
          width={64}
          height={64}
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground"
        >
          {initialsFrom(fallbackName)}
        </div>
      )}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? t('profile.avatarUploading') : t('profile.avatarUpload')}
          </Button>
          {avatarUrl ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void onRemove()}>
              {t('profile.avatarRemove')}
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => void onFile(e)}
        />
        <p className="text-muted-foreground text-sm">{t('profile.avatarHint')}</p>
        {error ? (
          <p role="alert" className="text-red-700 text-sm">
            {t('profile.avatarError')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
