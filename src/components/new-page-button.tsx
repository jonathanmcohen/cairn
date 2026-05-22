'use client';
import { Plus } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useActionAllowed } from '@/components/pwa/offline-context';
import { Button } from '@/components/ui/button';

export function NewPageButton({ parentId }: { parentId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const allowed = useActionAllowed('page-create');

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
      disabled={busy || !allowed}
      aria-label="New page"
      title={allowed ? 'New page' : 'Unavailable offline'}
      className="h-6 w-6"
    >
      <Plus aria-hidden="true" className="h-4 w-4" />
    </Button>
  );
}
