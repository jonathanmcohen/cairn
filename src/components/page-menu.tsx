'use client';

import { Button } from '@/components/ui/button';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';

export function PageMenu({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);

  function download(url: string) {
    const a = document.createElement('a');
    a.href = url;
    a.click();
  }

  async function importMd() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,text/markdown,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      await fetch(`/api/pages/${pageId}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: text }),
      });
      window.location.reload();
    };
    input.click();
  }

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-popover py-1 shadow-md"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              download(`/api/pages/${pageId}/export`);
              setOpen(false);
            }}
          >
            Export as .md
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              download(`/api/pages/${pageId}/export?recursive=true`);
              setOpen(false);
            }}
          >
            Export subtree as .zip
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              void importMd();
              setOpen(false);
            }}
          >
            Import markdown…
          </button>
        </div>
      )}
    </div>
  );
}
