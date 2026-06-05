'use client';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { WorkspaceCreateDialog } from '@/components/workspace-create-dialog';
import type { MemberRole } from '@/lib/auth/require-role';
import { useT } from '@/lib/i18n/provider';

export type SwitcherWorkspace = { id: string; name: string; role: MemberRole };

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

const ITEM_CLASS =
  'flex min-h-11 w-full cursor-pointer items-center rounded-xs px-2 py-1.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground';

export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: SwitcherWorkspace[];
  activeId: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
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
    // #82 — land on the new workspace's home page (resolveLandingPage runs at
    // '/'), not whatever route the user was on (e.g. /templates).
    router.push('/');
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={t('workspaceSwitcher.switch')}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] font-medium hover:bg-accent"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[0.65rem] font-medium text-muted-foreground"
            >
              {initial(active?.name ?? '?')}
            </span>
            <span className="truncate">{active?.name ?? 'No workspace'}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <DropdownMenu.Label className="px-2 py-1.5 text-sm font-semibold">
              {t('workspaceSwitcher.heading')}
            </DropdownMenu.Label>
            {workspaces.map((w) => (
              <DropdownMenu.Item
                key={w.id}
                onSelect={() => void switchTo(w.id)}
                className={ITEM_CLASS}
              >
                <Check
                  className={`mr-1 h-4 w-4 shrink-0 ${w.id === activeId ? 'opacity-100' : 'opacity-0'}`}
                />
                <span
                  aria-hidden="true"
                  className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[0.65rem] font-medium text-muted-foreground"
                >
                  {initial(w.name)}
                </span>
                <span className="truncate">{w.name}</span>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-muted" />
            <DropdownMenu.Item onSelect={() => setCreateOpen(true)} className={ITEM_CLASS}>
              <Plus className="mr-2 h-4 w-4 shrink-0" />
              {t('workspaceSwitcher.create')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <WorkspaceCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
