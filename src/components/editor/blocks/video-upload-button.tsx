'use client';

import { useState } from 'react';

export type VideoUploadButtonProps = {
  onUploaded: (info: { fileId: string; mimeType: string }) => void;
};

/**
 * Slim file-input wrapper used by the video node-view's first-mount UI. Mirrors
 * the image/file-upload slash-command pattern: POSTs to `/api/upload` (the
 * existing route that wraps `storeUpload`), then hands the resulting fileId +
 * mimeType back to the caller via `onUploaded`. The video MIME allowlist
 * extension (mp4/webm) lives in `src/lib/files/upload.ts`.
 */
export function VideoUploadButton({ onUploaded }: VideoUploadButtonProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? 'upload failed');
        return;
      }
      const json = (await res.json()) as { file: { id: string; mimeType: string } };
      onUploaded({ fileId: json.file.id, mimeType: json.file.mimeType });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept="video/mp4,video/webm"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      {busy && <p className="text-sm text-muted-foreground">Uploading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
