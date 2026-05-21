'use client';
import { Plus } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function NewPageButton({ parentId }: { parentId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parentId ? { parentId } : {}),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const created = (await res.json()) as { id: string };
      router.push(`/pages/${created.id}` as Route);
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={busy}
      aria-label="New page"
      title="New page"
      className="h-6 w-6"
    >
      <Plus className="h-4 w-4" />
    </Button>
  );
}
