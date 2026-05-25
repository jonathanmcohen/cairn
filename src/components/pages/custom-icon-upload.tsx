'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatIcon } from '@/lib/pages/icon-format';

export type CustomIconUploadProps = {
  onUploaded: (formattedIcon: string) => void;
};

export function CustomIconUpload({ onUploaded }: CustomIconUploadProps) {
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch('/api/files', { method: 'POST', body: form });
      if (!res.ok) return;
      const json = (await res.json()) as { id: string };
      onUploaded(formatIcon({ kind: 'file', value: json.id }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {busy && <Button disabled>Uploading…</Button>}
    </div>
  );
}
