'use client';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { MemberRole } from '@/lib/auth/require-role';

export type SwitcherWorkspace = { id: string; name: string; role: MemberRole };

export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: SwitcherWorkspace[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  async function switchTo(id: string) {
    if (id === activeId || busy) return;
    setBusy(true);
    await fetch('/api/workspaces/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: id }),
    });
    setBusy(false);
    router.refresh();
  }

  async function createWorkspace() {
    const name = window.prompt('New workspace name');
    if (!name?.trim()) return;
    setBusy(true);
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      router.push('/');
    }
  }

  return (
    <details className="group relative">
      <summary className="list-none [&::-webkit-details-marker]:hidden">
        <Button
          asChild
          variant="ghost"
          className="w-full cursor-pointer justify-between font-semibold"
          disabled={busy}
        >
          <span>
            <span className="truncate">{active?.name ?? 'No workspace'}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
          </span>
        </Button>
      </summary>
      <div className="absolute left-0 z-50 mt-1 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        <p className="px-2 py-1.5 text-sm font-semibold">Workspaces</p>
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => void switchTo(w.id)}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <Check className={`mr-2 h-4 w-4 ${w.id === activeId ? 'opacity-100' : 'opacity-0'}`} />
            <span className="truncate">{w.name}</span>
          </button>
        ))}
        <div className="-mx-1 my-1 h-px bg-muted" />
        <button
          type="button"
          onClick={() => void createWorkspace()}
          className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="mr-2 h-4 w-4" />
          Create workspace
        </button>
      </div>
    </details>
  );
}
