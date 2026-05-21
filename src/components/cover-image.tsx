'use client';

import { Button } from '@/components/ui/button';
import { useState } from 'react';

export function CoverImage({ pageId, initial }: { pageId: string; initial: string | null }) {
  const [src, setSrc] = useState<string | null>(initial);

  async function upload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) return;
      const { signedUrl } = (await res.json()) as { signedUrl: string };
      const patch = await fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverUrl: signedUrl }),
      });
      if (patch.ok) setSrc(signedUrl);
    };
    input.click();
  }

  async function remove() {
    const res = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ coverUrl: null }),
    });
    if (res.ok) setSrc(null);
  }

  if (!src) {
    return (
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={upload}>
          + Add cover
        </Button>
      </div>
    );
  }
  return (
    <div className="group relative mb-6 h-48 overflow-hidden rounded-lg">
      <img src={src} alt="" className="h-full w-full object-cover" />
      <div className="absolute top-2 right-2 flex gap-2 opacity-0 transition group-hover:opacity-100">
        <Button variant="secondary" size="sm" onClick={upload}>
          Change
        </Button>
        <Button variant="secondary" size="sm" onClick={remove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
